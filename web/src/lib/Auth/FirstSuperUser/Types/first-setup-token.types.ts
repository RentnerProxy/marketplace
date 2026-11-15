export type FirstSetupTokenTransfer =
    | { status: 'captured'; token: string }
    | { status: 'missing' | 'invalid' | 'inactive' }

export type FirstSetupBrowser = Pick<EventTarget, 'addEventListener'> & {
    location: Pick<Location, 'pathname' | 'search' | 'hash'>
    history: {
        readonly state: unknown
        replaceState: (state: unknown, unused: string, url: string) => void
    }
}

export type FirstSetupTokenHandoff = {
    take: () => FirstSetupTokenTransfer
    discard: () => void
    subscribe: (listener: () => void) => () => void
}
