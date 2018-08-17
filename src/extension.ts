// TODO!(sqs): make it so all or most of these are imported just via `cxp`
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
import { Settings, resolveSettings } from './settings'
import { Model } from './model'
import { codecovToDecorations } from './decoration'
import {
    resolveURI,
    ResolvedURI,
    codecovParamsForRepositoryCommit,
} from './uri'

const SET_API_TOKEN_COMMAND_ID = 'codecov.setAPIToken'

/** Entrypoint for the Codecov CXP extension. */
export function run(connection: Connection): void {
    let root: Pick<ResolvedURI, 'repo' | 'rev'> | null = null
    let settings!: Settings

    // Initialize the connection and report the features (capabilities) of this extension to the client.
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
                decorationProvider: true,
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
