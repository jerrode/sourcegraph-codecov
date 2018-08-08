/**
 * The resolved and normalized settings for this extension, the result of calling resolveSettings on a RawSettings
 * value.
 *
 * See the configuration JSON Schema in extension.json for the canonical documentation on these properties.
 */
export interface Settings {
    ['codecov.decorations']: DecorationSettings
    ['codecov.endpoints']: Endpoint[]
}

/** The raw settings for this extension. Most callers should use Settings instead. */
export interface RawSettings {
    ['codecov.decorations']?: Settings['codecov.decorations']
    ['codecov.endpoints']?: Settings['codecov.endpoints']
}

/** Returns a copy of the extension settings with values normalized and defaults applied. */
export function resolveSettings(raw: RawSettings): Settings {
    return {
        ['codecov.decorations']: resolveDecorations(raw),
        ['codecov.endpoints']: resolveEndpoints(raw),
    }
}

export interface Endpoint {
    url: string
    token?: string
}

const CODECOV_IO_URL = 'https://codecov.io'

function resolveEndpoints(raw: RawSettings): Endpoint[] {
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

export interface DecorationSettings {
    hide?: boolean
    lineBackgroundColors?: boolean
    lineHitCounts?: boolean
}

function resolveDecorations(raw: RawSettings): DecorationSettings {
    const decorations = raw['codecov.decorations']
    if (!decorations) {
        return { lineBackgroundColors: true }
    }
    if (decorations.hide) {
        return { hide: true }
    }
    return {
        lineBackgroundColors: decorations.lineBackgroundColors !== false, // default true
        lineHitCounts: !!decorations.lineHitCounts, // default false
    }
}
