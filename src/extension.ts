import { createWebWorkerMessageTransports } from 'cxp/module/jsonrpc2/transports/webWorker'
import { InitializeResult, InitializeParams } from 'cxp/module/protocol'
import {
    TextDocumentDecoration,
    ExecuteCommandParams,
    ConfigurationUpdateRequest,
    ConfigurationUpdateParams,
    DidChangeConfigurationParams,
    TextDocumentPublishDecorationsNotification,
    TextDocumentPublishDecorationsParams,
} from 'cxp/lib'
import { Connection, createConnection } from 'cxp/module/server/server'
import { TextDocuments } from 'cxp/module/server/features/textDocumentSync'
import { isEqual } from 'cxp/module/util'
import { TextDocument } from 'vscode-languageserver-types/lib/umd/main'
import { iconURL } from './icon'
import { Settings, resolveSettings } from './settings'
import { Model } from './model'
import { codecovToDecorations } from './decoration'
import { hsla, GREEN_HUE, RED_HUE } from './colors'
import { resolveURI, ResolvedURI } from './uri'

const TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID =
    'codecov.decorations.coverage.toggle'
const TOGGLE_HITS_DECORATIONS_COMMAND_ID = 'codecov.decorations.hits.toggle'
const VIEW_COVERAGE_DETAILS_COMMAND_ID = 'codecov.viewCoverageDetails'
const SET_API_TOKEN_COMMAND_ID = 'codecov.setAPIToken'
const HELP_COMMAND_ID = 'codecov.help'

export function run(connection: Connection): void {
    let initialized = false
    let root: Pick<ResolvedURI, 'repo' | 'rev'> | null = null
    let settings!: Settings
    let lastOpenedTextDocument: TextDocument | undefined

    // Track the currently open document.
    const textDocuments = new TextDocuments()
    textDocuments.listen(connection)
    textDocuments.onDidOpen(
        ({ document }) => (lastOpenedTextDocument = document)
    )
    textDocuments.onDidClose(({ document }) => {
        if (
            lastOpenedTextDocument &&
            lastOpenedTextDocument.uri === document.uri
        ) {
            lastOpenedTextDocument = undefined
        }
    })

    connection.onInitialize(
        (params: InitializeParams & { originalRootUri?: string }) => {
            if (initialized) {
                throw new Error('already initialized')
            }
            initialized = true

            // Use original root if proxied so we know which repository/revision this is for.
            const rootStr = params.originalRootUri || params.root || undefined
            if (rootStr) {
                root = resolveURI(null, rootStr)
            }

            // TODO!(sqs): make typesafe
            settings = resolveSettings(
                params.initializationOptions.settings.merged
            )

            return {
                capabilities: {
                    textDocumentSync: {
                        openClose: true,
                    },
                    executeCommandProvider: {
                        commands: [
                            TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                            TOGGLE_HITS_DECORATIONS_COMMAND_ID,
                            VIEW_COVERAGE_DETAILS_COMMAND_ID,
                            SET_API_TOKEN_COMMAND_ID,
                            HELP_COMMAND_ID,
                        ],
                    },
                    decorationProvider: { dynamic: true },
                    contributions: {
                        commands: [
                            {
                                command: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                title:
                                    '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} code coverage decorations on file',
                                category: 'Codecov',
                                actionItem: {
                                    label: 'Coverage: ${codecov.foo}%',
                                    description:
                                        '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} code coverage',
                                    iconURL: iconURL(),
                                    iconDescription: 'Codecov logo',
                                },
                            },
                            {
                                command: TOGGLE_HITS_DECORATIONS_COMMAND_ID,
                                title:
                                    '${config.codecov.decorations.lineHitCounts && "Hide" || "Show"} line hit/branch counts',
                                category: 'Codecov',
                            },
                            {
                                // TODO!(sqs): this isn't actually implemented
                                command: VIEW_COVERAGE_DETAILS_COMMAND_ID,
                                title: 'View coverage details',
                                category: 'Codecov',
                            },
                            {
                                command: SET_API_TOKEN_COMMAND_ID,
                                title:
                                    'Set API token for private repositories...',
                                category: 'Codecov',
                            },
                            {
                                command: HELP_COMMAND_ID,
                                title: 'Documentation and support',
                                category: 'Codecov',
                                iconURL: iconURL(),
                            },
                        ],
                        menus: {
                            'editor/title': [
                                {
                                    command: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                    // TODO(sqs): When we add support for extension config default values, flip
                                    // this to config.codecov.showCoverageButton. (We need to make it "hide"
                                    // because the default for unset is falsey, since extensions can't provide
                                    // their own defaults yet.)
                                    when:
                                        'component && component.type == "textEditor" && !config.codecov.hideCoverageButton',
                                },
                            ],
                            commandPalette: [
                                {
                                    command: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                },
                                { command: TOGGLE_HITS_DECORATIONS_COMMAND_ID },
                                { command: VIEW_COVERAGE_DETAILS_COMMAND_ID },
                                { command: SET_API_TOKEN_COMMAND_ID },
                            ],
                            help: [{ command: HELP_COMMAND_ID }],
                        },
                    },
                },
            } as InitializeResult
        }
    )

    async function updateFileCoverageClientContext(): Promise<void> {
        if (!root) {
            return
        }
        const fileRatios = await Model.getFileCoverageRatios(root, settings)
        const context: { [key: string]: string } = {}
        for (const [path, ratio] of Object.entries(fileRatios)) {
            context[`codecov.foo`] = Math.floor(ratio).toString()
        }
        connection.context.updateContext(context)
    }

    connection.onInitialized(() => updateFileCoverageClientContext())

    connection.onDidChangeConfiguration(
        async (params: DidChangeConfigurationParams) => {
            const newSettings: Settings = resolveSettings(
                params.configurationCascade.merged
            ) // merged is (global + org + user) settings
            if (isEqual(settings, newSettings)) {
                return // nothing to do
            }
            const oldSettings = settings
            settings = newSettings
            // Don't bother updating client view state if there is no document yet.
            if (lastOpenedTextDocument) {
                await publishDecorations(newSettings, textDocuments.all())
            }

            if (
                !isEqual(
                    settings['codecov.endpoints'],
                    oldSettings['codecov.endpoints']
                )
            ) {
                await updateFileCoverageClientContext()
            }
        }
    )

    textDocuments.onDidOpen(async ({ document }) => {
        if (settings) {
            await publishDecorations(settings, [document])

            try {
                const ratio = await Model.getFileCoverageRatio(
                    resolveURI(root, document.uri),
                    settings
                )
                connection.console.log(
                    `File coverage ratio: ${
                        ratio ? `${ratio.toFixed(0)}%` : 'unknown'
                    }`
                )
                if (ratio !== undefined) {
                    console.log(
                        '%cCoverage',
                        `color:white;background-color:${iconColor(ratio)}`
                    )
                }
            } catch (err) {
                connection.console.error(
                    `Error computing file coverage ratio for ${
                        document.uri
                    }: ${err}`
                )
            }
        }
    })

    connection.onExecuteCommand((params: ExecuteCommandParams) => {
        const executeConfigurationCommand = (
            newSettings: Settings,
            configParams: ConfigurationUpdateParams
        ) => {
            // Run async to avoid blocking our response (and leading to a deadlock).
            connection
                .sendRequest(ConfigurationUpdateRequest.type, configParams)
                .catch(err => console.error('configuration/update:', err))
            publishDecorations(newSettings, textDocuments.all()).catch(err =>
                console.error('publishDecorations:', err)
            )
        }

        switch (params.command) {
            case TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID:
                const newValue = !settings['codecov.decorations.lineCoverage']
                settings['codecov.decorations.lineCoverage'] = newValue
                executeConfigurationCommand(settings, {
                    path: ['codecov.decorations.lineCoverage'],
                    value: settings['codecov.decorations.lineCoverage'],
                })
                break
            case TOGGLE_HITS_DECORATIONS_COMMAND_ID:
                settings['codecov.decorations.lineHitCounts'] = !settings[
                    'codecov.decorations.lineHitCounts'
                ]
                executeConfigurationCommand(settings, {
                    path: ['codecov.decorations.lineHitCounts'],
                    value: settings['codecov.decorations.lineHitCounts'],
                })
                break

            case VIEW_COVERAGE_DETAILS_COMMAND_ID:
                break

            case SET_API_TOKEN_COMMAND_ID:
                const endpoint = settings['codecov.endpoints'][0]
                connection.window
                    .showInputRequest(
                        `Codecov API token (for private repositories on ${
                            endpoint.url
                        }):`,
                        endpoint.token
                    )
                    .then(token => {
                        if (token !== null) {
                            return executeConfigurationCommand(settings!, {
                                path: ['codecov.endpoints', 0, 'token'],
                                value: token || null, // '' will remove, as desired
                            })
                        }
                    })
                    .catch(err =>
                        console.error(`${SET_API_TOKEN_COMMAND_ID}:`, err)
                    )

            case HELP_COMMAND_ID:
                break

            default:
                throw new Error(`unknown command: ${params.command}`)
        }
    })

    async function publishDecorations(
        settings: Settings,
        documents: TextDocument[]
    ): Promise<void> {
        for (const { uri } of documents) {
            connection.sendNotification(
                TextDocumentPublishDecorationsNotification.type,
                {
                    textDocument: { uri },
                    decorations: await getDecorations(root, settings, uri),
                } as TextDocumentPublishDecorationsParams
            )
        }
    }

    async function getDecorations(
        root: Pick<ResolvedURI, 'repo' | 'rev'> | null,
        settings: Settings,
        uri: string
    ): Promise<TextDocumentDecoration[]> {
        return codecovToDecorations(
            settings,
            await Model.getFileLineCoverage(resolveURI(root, uri), settings)
        )
    }
}

function iconColor(coverageRatio: number): string {
    return hsla(coverageRatio * ((GREEN_HUE - RED_HUE) / 100), 0.25, 1)
}

const connection = createConnection(
    createWebWorkerMessageTransports(self as DedicatedWorkerGlobalScope)
)
run(connection)
connection.listen()
