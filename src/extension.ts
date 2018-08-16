import { createWebWorkerMessageTransports } from 'cxp/module/jsonrpc2/transports/webWorker'
import { InitializeResult, InitializeParams } from 'cxp/module/protocol'
import {
    ExecuteCommandParams,
    ConfigurationUpdateRequest,
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
import {
    resolveURI,
    ResolvedURI,
    codecovParamsForRepositoryCommit,
} from './uri'

const TOGGLE_COVERAGE_DECORATIONS_ACTION_ID =
    'codecov.decorations.toggleCoverage'
const TOGGLE_HITS_DECORATIONS_ACTION_ID = 'codecov.decorations.toggleHits'
const TOGGLE_BUTTON_ACTION_ID = 'codecov.button.toggle'
const VIEW_FILE_COVERAGE_ACTION_ID = 'codecov.link.file'
const VIEW_COMMIT_COVERAGE_ACTION_ID = 'codecov.link.commit'
const VIEW_REPO_COVERAGE_ACTION_ID = 'codecov.link.repository'
const SET_API_TOKEN_COMMAND_ID = 'codecov.setAPIToken'
const HELP_ACTION_ID = 'codecov.help'

export function run(connection: Connection): void {
    let root: Pick<ResolvedURI, 'repo' | 'rev'> | null = null
    let settings!: Settings

    connection.onInitialize((params: InitializeParams) => {
        if (params.root) {
            root = resolveURI(null, params.root)
        }
        settings = resolveSettings(params.initializationOptions.settings.merged)
        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                },
                executeCommandProvider: {
                    commands: [SET_API_TOKEN_COMMAND_ID],
                },
                decorationProvider: { dynamic: true },
                contributions: {
                    actions: [
                        {
                            id: TOGGLE_COVERAGE_DECORATIONS_ACTION_ID,
                            command: 'updateConfiguration',
                            commandArguments: [
                                ['codecov.decorations.lineCoverage'],
                                '${!config.codecov.decorations.lineCoverage}',
                                null,
                                'json',
                            ],
                            title:
                                '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} line coverage on file${get(context, `codecov.coverageRatio.${resource.uri}`) && ` (${get(context, `codecov.coverageRatio.${resource.uri}`)}% coverage)` || ""}',
                            category: 'Codecov',
                            actionItem: {
                                label:
                                    'Coverage: ${get(context, `codecov.coverageRatio.${resource.uri}`)}%',
                                description:
                                    '${config.codecov.decorations.lineCoverage && "Hide" || "Show"} code coverage\nCmd/Ctrl+Click: View on Codecov',
                            },
                        },
                        {
                            id: TOGGLE_HITS_DECORATIONS_ACTION_ID,
                            command: 'updateConfiguration',
                            commandArguments: [
                                ['codecov.decorations.lineHitCounts'],
                                '${!config.codecov.decorations.lineHitCounts}',
                                null,
                                'json',
                            ],
                            title:
                                '${config.codecov.decorations.lineHitCounts && "Hide" || "Show"} line hit/branch counts',
                            category: 'Codecov',
                        },
                        {
                            id: TOGGLE_BUTTON_ACTION_ID,
                            command: 'updateConfiguration',
                            commandArguments: [
                                ['codecov.hideCoverageButton'],
                                '${!config.codecov.hideCoverageButton}',
                                null,
                                'json',
                            ],
                            title:
                                '${config.codecov.hideCoverageButton && "Show" || "Hide"} coverage % button',
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
                                action: TOGGLE_COVERAGE_DECORATIONS_ACTION_ID,
                                alt: VIEW_FILE_COVERAGE_ACTION_ID,
                                when:
                                    '!config.codecov.hideCoverageButton && get(context, `codecov.coverageRatio.${resource.uri}`)',
                            },
                        ],
                        commandPalette: [
                            {
                                action: TOGGLE_COVERAGE_DECORATIONS_ACTION_ID,
                            },
                            { action: TOGGLE_HITS_DECORATIONS_ACTION_ID },
                            {
                                action: TOGGLE_BUTTON_ACTION_ID,
                                when:
                                    'get(context, `codecov.coverageRatio.${resource.uri}`)',
                            },
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
                            { action: HELP_ACTION_ID },
                        ],
                        help: [{ action: HELP_ACTION_ID }],
                    },
                },
            },
        } as InitializeResult
    })

    // Track the current opened text documents.
    const textDocuments = new TextDocuments()
    textDocuments.listen(connection)

    // Update context values and decorations whenever the settings change.
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

            await publishDecorations(newSettings, textDocuments.all())

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

    // Update decorations when the user navigates to file.
    textDocuments.onDidOpen(({ document }) =>
        publishDecorations(settings, [document])
    )

    // Handle the "Set Codecov API token" command (show the user a prompt for their token, and save
    // their input to settings).
    connection.onExecuteCommand((params: ExecuteCommandParams) => {
        switch (params.command) {
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
                            return connection.sendRequest(
                                ConfigurationUpdateRequest.type,
                                {
                                    // TODO: Only supports setting the token of the first API endpoint.
                                    path: ['codecov.endpoints', 0, 'token'],
                                    value: token || null, // '' will remove, as desired
                                }
                            )
                        }
                        return
                    })
                    .catch(err => console.error(err))

            default:
                throw new Error(`unknown command: ${params.command}`)
        }
    })

    /**
     * Publishes line background colors and annotations based on settings and coverage data from the
     * Codecov API.
     */
    async function publishDecorations(
        settings: Settings,
        documents: TextDocument[]
    ): Promise<void> {
        for (const { uri } of documents) {
            connection.sendNotification(
                TextDocumentPublishDecorationsNotification.type,
                {
                    textDocument: { uri },
                    decorations: codecovToDecorations(
                        settings,
                        await Model.getFileLineCoverage(
                            resolveURI(root, uri),
                            settings
                        )
                    ),
                } as TextDocumentPublishDecorationsParams
            )
        }
    }

    /**
     * Set context values that the template strings in the contributions above can refer to. This
     * should be called whenever the settings change.
     */
    async function updateFileCoverageClientContext(): Promise<void> {
        if (!root) {
            return
        }

        const context: { [key: string]: string | number | boolean | null } = {}

        const p = codecovParamsForRepositoryCommit(root)
        const repoURL = `https://codecov.io/${p.service}/${p.owner}/${p.repo}` // TODO Support non-codecov.io endpoints.
        context['codecov.repoURL'] = repoURL
        const baseFileURL = `${repoURL}/src/${p.sha}`
        context['codecov.commitURL'] = `${repoURL}/commit/${p.sha}`

        try {
            // Store overall commit coverage ratio.
            const commitCoverage = await Model.getCommitCoverageRatio(
                root,
                settings
            )
            context['codecov.commitCoverage'] = commitCoverage
                ? commitCoverage.toFixed(1)
                : null

            // Store coverage ratio (and Codecov report URL) for each file at this commit so that
            // template strings in contributions can refer to these values.
            const fileRatios = await Model.getFileCoverageRatios(root, settings)
            for (const [path, ratio] of Object.entries(fileRatios)) {
                const uri = `git://${root.repo}?${root.rev}#${path}`
                context[`codecov.coverageRatio.${uri}`] = Math.floor(
                    ratio
                ).toString()

                context[`codecov.fileURL.${uri}`] = `${baseFileURL}/${path}`
            }
        } catch (err) {
            connection.console.error(
                `Error loading Codecov file coverage: ${err}`
            )
        }
        connection.context.updateContext(context)
    }
}

// This runs in a Web Worker and communicates using postMessage with the page.
const connection = createConnection(
    createWebWorkerMessageTransports(self as DedicatedWorkerGlobalScope)
)
run(connection)
connection.listen()
