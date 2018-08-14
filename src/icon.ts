const CODECOV_BRAND_COLOR = encodeURIComponent('#E0225C') // Chrome complains if '#' is not escaped

/** Returns a data: URI of the Codecov logo with the given background color. */
export function iconURL(foregroundColor: string = CODECOV_BRAND_COLOR): string {
    return `data:image/svg+xml,` + iconSVGWithColor(foregroundColor)
}

function iconSVGWithColor(foregroundColor: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><svg width="2278" height="2500" viewBox="0 0 256 281" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid"><path d="M218.551 37.419C194.416 13.289 162.33 0 128.097 0 57.537.047.091 57.527.04 128.121L0 149.813l16.859-11.49c11.468-7.814 24.75-11.944 38.417-11.944 4.079 0 8.198.373 12.24 1.11 12.742 2.32 24.165 8.089 33.414 16.758 2.12-4.67 4.614-9.209 7.56-13.536a88.081 88.081 0 0 1 3.805-5.15c-11.652-9.84-25.649-16.463-40.926-19.245a90.35 90.35 0 0 0-16.12-1.459 88.377 88.377 0 0 0-32.29 6.07c8.36-51.222 52.85-89.37 105.23-89.408 28.392 0 55.078 11.053 75.149 31.117 16.011 16.01 26.254 36.033 29.788 58.117-10.329-4.035-21.212-6.1-32.403-6.144l-1.568-.007a90.957 90.957 0 0 0-3.401.111c-1.955.1-3.898.277-5.821.5-.574.063-1.139.153-1.707.231-1.378.186-2.75.395-4.109.639-.603.11-1.203.231-1.8.351a90.517 90.517 0 0 0-4.114.937c-.492.126-.983.243-1.47.374a90.183 90.183 0 0 0-5.09 1.538c-.1.035-.204.063-.304.096a87.532 87.532 0 0 0-11.057 4.649c-.097.05-.193.101-.293.151a86.7 86.7 0 0 0-4.912 2.701l-.398.238a86.09 86.09 0 0 0-22.302 19.253c-.262.318-.524.635-.784.958-1.376 1.725-2.718 3.49-3.976 5.336a91.412 91.412 0 0 0-3.672 5.913 90.235 90.235 0 0 0-2.496 4.638c-.044.09-.089.175-.133.265a88.786 88.786 0 0 0-4.637 11.272l-.002.009v.004a88.006 88.006 0 0 0-4.509 29.313c.005.397.005.794.019 1.192.021.777.06 1.557.104 2.338a98.66 98.66 0 0 0 .289 3.834c.078.804.174 1.606.275 2.41.063.512.119 1.026.195 1.534a90.11 90.11 0 0 0 .658 4.01c4.339 22.938 17.261 42.937 36.39 56.316l2.446 1.564.02-.048a88.572 88.572 0 0 0 36.232 13.45l1.746.236 12.974-20.822-4.664-.127c-35.898-.985-65.1-31.003-65.1-66.917 0-35.348 27.624-64.702 62.876-66.829l2.23-.085c14.292-.362 28.372 3.859 40.325 11.997l16.781 11.421.036-21.58c.027-34.219-13.272-66.379-37.449-90.554" fill="${foregroundColor}"/></svg>`
}
