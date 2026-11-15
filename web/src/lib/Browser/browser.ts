export function getCurrentBrowserPath() {
    if (typeof window === 'undefined') {
        return null
    }

    return `${window.location.pathname}${window.location.search}${window.location.hash}`
}
