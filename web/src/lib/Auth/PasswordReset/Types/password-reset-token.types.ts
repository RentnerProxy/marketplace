export type PasswordResetTokenTransfer =
    | { status: 'captured'; token: string }
    | { status: 'missing' | 'invalid' | 'inactive' }

export type PasswordResetBrowser = Pick<EventTarget, 'addEventListener'> & {
    location: Pick<Location, 'pathname' | 'search' | 'hash'>
    history: {
        readonly state: unknown
        replaceState: (state: unknown, unused: string, url: string) => void
    }
}

export type PasswordResetTokenHandoff = {
    take: () => PasswordResetTokenTransfer
    discard: () => void
    subscribe: (listener: () => void) => () => void
}
