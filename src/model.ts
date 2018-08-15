import {
    codecovGetCommitCoverage,
    CodecovGetCommitCoverageArgs,
    CodecovCommitData,
} from './api'
import { ResolvedURI, codecovParamsForRepositoryCommit } from './uri'
import { Settings } from './settings'

export interface FileLineCoverage {
    [line: string]: LineCoverage
}

export type LineCoverage = number | { hits: number; branches: number } | null

/**
 * The model provides data from Codecov.
 */
export class Model {
    /** Gets the coverage ratio for a commit. */
    public static async getCommitCoverageRatio(
        { repo, rev }: Pick<ResolvedURI, 'repo' | 'rev'>,
        settings: Settings
    ): Promise<number | undefined> {
        const data = await codecovGetCommitCoverage({
            ...codecovParamsForRepositoryCommit({ repo, rev }),
            ...codecovParamsForEndpoint(settings),
        })
        return data.commit.totals.coverage
    }

    /** Gets line coverage data for a file at a given commit in a repository. */
    public static async getFileLineCoverage(
        { repo, rev, path }: ResolvedURI,
        settings: Settings
    ): Promise<FileLineCoverage> {
        const data = await codecovGetCommitCoverage({
            ...codecovParamsForRepositoryCommit({ repo, rev }),
            ...codecovParamsForEndpoint(settings),
        })
        return toLineCoverage(data, path)
    }

    /** Gets the file coverage ratio for a file at a given commit in a repository. */
    public static async getFileCoverageRatio(
        { repo, rev, path }: ResolvedURI,
        settings: Settings
    ): Promise<number | undefined> {
        const data = await codecovGetCommitCoverage({
            ...codecovParamsForRepositoryCommit({ repo, rev }),
            ...codecovParamsForEndpoint(settings),
        })
        return getFileCoverageRatio(data, path)
    }

    /** Gets the file coverage ratios for all files at a given commit in a repository. */
    public static async getFileCoverageRatios(
        { repo, rev }: Pick<ResolvedURI, 'repo' | 'rev'>,
        settings: Settings
    ): Promise<{ [path: string]: number }> {
        const data = await codecovGetCommitCoverage({
            ...codecovParamsForRepositoryCommit({ repo, rev }),
            ...codecovParamsForEndpoint(settings),
        })
        const ratios: { [path: string]: number } = {}
        for (const [path, fileData] of Object.entries(
            data.commit.report.files
        )) {
            const ratio = toCoverageRatio(fileData)
            if (ratio) {
                ratios[path] = ratio
            }
        }
        return ratios
    }
}

/**
 * Returns the parameters used to access the Codecov API at the given endpoint.
 *
 * Currently only the first endpoint in the extension settings is supported.
 */
function codecovParamsForEndpoint(
    settings: Settings
): Pick<CodecovGetCommitCoverageArgs, 'baseURL' | 'token'> {
    const endpoint = settings['codecov.endpoints'][0]
    return { baseURL: endpoint.url, token: endpoint.token }
}

function toLineCoverage(
    data: CodecovCommitData,
    path: string
): FileLineCoverage {
    const result: FileLineCoverage = {}
    const fileData = data.commit.report.files[path]
    if (fileData) {
        for (const [lineStr, value] of Object.entries(fileData.l)) {
            const line = parseInt(lineStr, 10)
            if (typeof value === 'number' || value === null) {
                result[line] = value
            } else if (typeof value === 'string') {
                const [hits, branches] = value
                    .split('/', 2)
                    .map(v => parseInt(v, 10))
                result[line] = { hits, branches }
            }
        }
    }
    return result
}

function getFileCoverageRatio(
    data: CodecovCommitData,
    path: string
): number | undefined {
    return toCoverageRatio(data.commit.report.files[path])
}

function toCoverageRatio(
    fileData: CodecovCommitData['commit']['report']['files'][string]
): number | undefined {
    const ratioStr = fileData && fileData.t.c
    if (!ratioStr) {
        return undefined
    }
    const ratio = parseFloat(ratioStr)
    if (Number.isNaN(ratio)) {
        return undefined
    }
    return ratio
}
