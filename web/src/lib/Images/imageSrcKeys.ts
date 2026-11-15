export function getImageSrcKey(src: string) {
    try {
        const baseUrl =
            typeof window === 'undefined'
                ? 'http://localhost'
                : window.location.origin
        const url = new URL(src, baseUrl)

        return `${url.pathname}${url.search}`
    } catch {
        return src
    }
}
