export type BrowserTokenTransfer =
    | { status: 'captured'; token: string }
    | { status: 'missing' | 'invalid' | 'inactive' }

export type TokenHandoffBrowser = Pick<EventTarget, 'addEventListener'> & {
    location: Pick<Location, 'pathname' | 'search' | 'hash'>
    history: {
        readonly state: unknown
        replaceState: (state: unknown, unused: string, url: string) => void
    }
}

export type BrowserTokenHandoff = {
    take: () => BrowserTokenTransfer
    discard: () => void
    subscribe: (listener: () => void) => () => void
}

export type BrowserTokenHandoffOptions = {
    isActivePath: (pathname: string) => boolean
    shouldCaptureFragmentChange?: (fragment: string) => boolean
    parseFragment: (fragment: string) => BrowserTokenTransfer
    canonicalPath: string
    clearUrlError: string
}
