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
import {
    resolveURI,
    ResolvedURI,
    codecovParamsForRepositoryCommit,
} from './uri'

const TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID =
    'codecov.decorations.coverage.toggle'
const TOGGLE_HITS_DECORATIONS_COMMAND_ID = 'codecov.decorations.hits.toggle'
const VIEW_FILE_COVERAGE_ACTION_ID = 'codecov.link.file'
const VIEW_COMMIT_COVERAGE_ACTION_ID = 'codecov.link.commit'
const VIEW_REPO_COVERAGE_ACTION_ID = 'codecov.link.repository'
const SET_API_TOKEN_COMMAND_ID = 'codecov.setAPIToken'
const HELP_ACTION_ID = 'codecov.help'

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
                            VIEW_FILE_COVERAGE_ACTION_ID,
                            SET_API_TOKEN_COMMAND_ID,
                            HELP_ACTION_ID,
                        ],
                    },
                    decorationProvider: { dynamic: true },
                    contributions: {
                        actions: [
                            {
                                id: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                command: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                title:
                                    '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} code coverage decorations on file',
                                category: 'Codecov',
                                actionItem: {
                                    label:
                                        'Coverage: ${get(context, `codecov.coverageRatio.${resource.uri}`)}%',
                                    description:
                                        '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} code coverage',
                                    iconURL: iconURL(
                                        iconColorExpr(
                                            'get(context, `codecov.coverageRatio.${resource.uri}`)'
                                        )
                                    ),
                                    iconDescription: 'Codecov logo',
                                },
                            },
                            {
                                id: TOGGLE_HITS_DECORATIONS_COMMAND_ID,
                                command: TOGGLE_HITS_DECORATIONS_COMMAND_ID,
                                title:
                                    '${config.codecov.decorations.lineHitCounts && "Hide" || "Show"} line hit/branch counts',
                                category: 'Codecov',
                            },
                            {
                                id: VIEW_FILE_COVERAGE_ACTION_ID,
                                command: 'open',
                                commandArguments: [
                                    '${get(context, `codecov.fileURL.${resource.uri}`)}',
                                ],
                                title: 'View file coverage report',
                                category: 'Codecov',
                            },
                            {
                                id: VIEW_COMMIT_COVERAGE_ACTION_ID,
                                command: 'open',
                                commandArguments: ['${codecov.commitURL}'],
                                title:
                                    'View commit report${codecov.commitCoverage && ` (${codecov.commitCoverage}% coverage)` || ""}',
                                category: 'Codecov',
                            },
                            {
                                id: VIEW_REPO_COVERAGE_ACTION_ID,
                                command: 'open',
                                commandArguments: ['${codecov.repoURL}'],
                                title: 'View repository coverage dashboard',
                                category: 'Codecov',
                            },
                            {
                                id: SET_API_TOKEN_COMMAND_ID,
                                command: SET_API_TOKEN_COMMAND_ID,
                                title: 'Set API token for private repositories',
                                category: 'Codecov',
                            },
                            {
                                id: HELP_ACTION_ID,
                                command: 'open',
                                commandArguments: ['https://docs.codecov.io'],
                                title: 'Documentation and support',
                                category: 'Codecov',
                                iconURL: iconURL(),
                            },
                        ],
                        menus: {
                            'editor/title': [
                                {
                                    action: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                    // TODO(sqs): When we add support for extension config default values, flip
                                    // this to config.codecov.showCoverageButton. (We need to make it "hide"
                                    // because the default for unset is falsey, since extensions can't provide
                                    // their own defaults yet.)
                                    //
                                    // TODO!(sqs): To avoid a flicker with no resource, make it so that the CXP
                                    // environment always sets a resource even if it has not loaded.
                                    when:
                                        '!config.codecov.hideCoverageButton && get(context, `codecov.coverageRatio.${resource.uri}`)',
                                },
                            ],
                            commandPalette: [
                                {
                                    action: TOGGLE_COVERAGE_DECORATIONS_COMMAND_ID,
                                },
                                { action: TOGGLE_HITS_DECORATIONS_COMMAND_ID },
                                {
                                    action: VIEW_FILE_COVERAGE_ACTION_ID,
                                    when:
                                        'get(context, `codecov.fileURL.${resource.uri}`)',
                                },
                                {
                                    action: VIEW_COMMIT_COVERAGE_ACTION_ID,
                                    when: 'codecov.commitURL',
                                },
                                {
                                    action: VIEW_REPO_COVERAGE_ACTION_ID,
                                    when: 'codecov.repoURL',
                                },
                                { action: SET_API_TOKEN_COMMAND_ID },
                            ],
                            help: [{ action: HELP_ACTION_ID }],
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

        const context: { [key: string]: string | number | boolean | null } = {}

        const p = codecovParamsForRepositoryCommit(root)
        const repoURL = `https://codecov.io/${p.service}/${p.owner}/${p.repo}`
        context['codecov.repoURL'] = repoURL
        const baseFileURL = `${repoURL}/src/${p.sha}`
        context['codecov.commitURL'] = `${repoURL}/commit/${p.sha}`

        try {
            const commitCoverage = await Model.getCommitCoverageRatio(
                root,
                settings
            )
            context['codecov.commitCoverage'] = commitCoverage
                ? commitCoverage.toFixed(1)
                : null

            const fileRatios = await Model.getFileCoverageRatios(root, settings)
            for (const [path, ratio] of Object.entries(fileRatios)) {
                const uri = `git://${root.repo}?${root.rev}#${path}`
                context[`codecov.coverageRatio.${uri}`] = Math.floor(
                    ratio
                ).toString()

                // TODO(sqs): Support non-codecov.io endpoints.
                context[`codecov.fileURL.${uri}`] = `${baseFileURL}/${path}`
            }
        } catch (err) {
            connection.console.error(
                `Error loading Codecov file coverage: ${err}`
            )
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

            case VIEW_FILE_COVERAGE_ACTION_ID:
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

            case HELP_ACTION_ID:
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

function iconColorExpr(coverageRatioExpr: string): string {
    return hsla(
        '${' +
            `${coverageRatioExpr} * ((${GREEN_HUE} - ${RED_HUE}) / 100)` +
            '}',
        0.25,
        1
    )
}

const connection = createConnection(
    createWebWorkerMessageTransports(self as DedicatedWorkerGlobalScope)
)
run(connection)
connection.listen()
