// TODO!(sqs): make it so all or most of these are imported just via `cxp`
import { createWebWorkerMessageTransports } from 'cxp/module/jsonrpc2/transports/webWorker'
import {
    ExecuteCommandParams,
    TextDocumentPublishDecorationsNotification,
    TextDocumentPublishDecorationsParams,
} from 'cxp/lib'
import { CXP, combineLatest } from 'cxp/module/extension/api'
import { activateExtension } from 'cxp/module/extension/extension'
import { Settings, resolveSettings, resolveEndpoint } from './settings'
import {
    getFileCoverageRatios,
    getCommitCoverageRatio,
    getFileLineCoverage,
} from './model'
import { codecovToDecorations } from './decoration'
import {
    resolveURI,
    ResolvedURI,
    codecovParamsForRepositoryCommit,
} from './uri'
import { ExecuteCommandRequest } from 'cxp/module/protocol'

const SET_API_TOKEN_COMMAND_ID = 'codecov.setAPIToken'

/** Entrypoint for the Codecov CXP extension. */
export function run(cxp: CXP<Settings>): void {
    const root: Pick<ResolvedURI, 'repo' | 'rev'> | null = cxp.root
        ? resolveURI(null, cxp.root)
        : null

    // When the configuration or current file changes, publish new decorations.
    //
    // TODO!(sqs): Unpublish decorations on previously (but not currently) open files when settings changes.
    combineLatest(cxp.configuration, cxp.activeWindow).subscribe(
        async ([configuration, window]) => {
            if (
                window &&
                window.activeComponent &&
                window.activeComponent.resource
            ) {
                const settings = resolveSettings(configuration)
                const uri = window.activeComponent.resource
                cxp.rawConnection.sendNotification(
                    TextDocumentPublishDecorationsNotification.type,
                    {
                        textDocument: { uri },
                        decorations: codecovToDecorations(
                            settings,
                            await getFileLineCoverage(
                                resolveURI(root, uri),
                                settings['codecov.endpoints'][0]
                            )
                        ),
                    } as TextDocumentPublishDecorationsParams
                )
            }
        }
    )

    // Set context values referenced in template expressions in the extension manifest (e.g., to interpolate "N" in
    // the "Coverage: N%" button label).
    //
    // The context only needs to be updated when the endpoints configuration changes.
    cxp.configuration
        .observe('codecov.endpoints')
        .subscribe(async configuration => {
            if (!root) {
                return
            }
            const endpoint = resolveEndpoint(configuration['codecov.endpoints'])

            const context: {
                [key: string]: string | number | boolean | null
            } = {}

            const p = codecovParamsForRepositoryCommit(root)
            // TODO Support non-codecov.io endpoints.
            const repoURL = `https://codecov.io/${p.service}/${p.owner}/${
                p.repo
            }`
            context['codecov.repoURL'] = repoURL
            const baseFileURL = `${repoURL}/src/${p.sha}`
            context['codecov.commitURL'] = `${repoURL}/commit/${p.sha}`

            try {
                // Store overall commit coverage ratio.
                const commitCoverage = await getCommitCoverageRatio(
                    root,
                    endpoint
                )
                context['codecov.commitCoverage'] = commitCoverage
                    ? commitCoverage.toFixed(1)
                    : null

                // Store coverage ratio (and Codecov report URL) for each file at this commit so that
                // template strings in contributions can refer to these values.
                const fileRatios = await getFileCoverageRatios(root, endpoint)
                for (const [path, ratio] of Object.entries(fileRatios)) {
                    const uri = `git://${root.repo}?${root.rev}#${path}`
                    context[`codecov.coverageRatio.${uri}`] = ratio.toFixed(0)
                    context[`codecov.fileURL.${uri}`] = `${baseFileURL}/${path}`
                }
            } catch (err) {
                console.error(`Error loading Codecov file coverage: ${err}`)
            }
            cxp.context.updateContext(context)
        })

    // Handle the "Set Codecov API token" command (show the user a prompt for their token, and save
    // their input to settings).
    cxp.rawConnection.onRequest(
        ExecuteCommandRequest.type,
        async (params: ExecuteCommandParams) => {
            if (params.command === SET_API_TOKEN_COMMAND_ID) {
                const endpoint = resolveEndpoint(
                    cxp.configuration.get('codecov.endpoints')
                )
                const token = await cxp.activeWindow.value.showInputBox(
                    `Codecov API token (for ${endpoint.url}):`,
                    endpoint.token || ''
                )
                if (token !== null) {
                    // TODO: Only supports setting the token of the first API endpoint.
                    endpoint.token = token || undefined
                    return cxp.configuration.update('codecov.endpoints', [
                        endpoint,
                    ])
                }
            } else {
                throw new Error(`unknown command: ${params.command}`)
            }
        }
    )
}

// This runs in a Web Worker and communicates using postMessage with the page.
activateExtension<Settings>(
    createWebWorkerMessageTransports(self as DedicatedWorkerGlobalScope),
    run
)
