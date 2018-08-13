/**
 * The resolved and normalized settings for this extension, the result of calling resolveSettings on a RawSettings
 * value.
 *
 * See the configuration JSON Schema in extension.json for the canonical documentation on these properties.
 */
export interface Settings {
    ['codecov.showCoverage']: boolean
    ['codecov.decorations.lineCoverage']: boolean
    ['codecov.decorations.lineHitCounts']: boolean
    ['codecov.endpoints']: Endpoint[]
}

/** Returns a copy of the extension settings with values normalized and defaults applied. */
export function resolveSettings(raw: Settings): Settings {
    return {
        ['codecov.showCoverage']: raw['codecov.showCoverage'] !== false,
        ['codecov.decorations.lineCoverage']:
            raw['codecov.decorations.lineCoverage'] !== false,
        ['codecov.decorations.lineHitCounts']: !!raw[
            'codecov.decorations.lineHitCounts'
        ],
        ['codecov.endpoints']: resolveEndpoints(raw),
    }
}

export interface Endpoint {
    url: string
    token?: string
}

const CODECOV_IO_URL = 'https://codecov.io'

function resolveEndpoints(raw: Settings): Endpoint[] {
    const endpoints = raw['codecov.endpoints']
    if (!endpoints || endpoints.length === 0) {
        return [{ url: CODECOV_IO_URL }]
    }
    return endpoints.map(({ url, token }) => ({
        url: url ? urlWithOnlyProtocolAndHost(url) : CODECOV_IO_URL,
        token,
    }))
}

function urlWithOnlyProtocolAndHost(urlStr: string): string {
    const url = new URL(urlStr)
    return `${url.protocol}//${url.host}`
}
