const SETUP_ACCESS_FRAGMENT_PATTERN = /^#access=([A-Za-z0-9_-]{43})$/

export function getSetupAccessTokenFromFragment(fragment: string) {
    if (fragment.length !== '#access='.length + 43) return null
    return SETUP_ACCESS_FRAGMENT_PATTERN.exec(fragment)?.[1] ?? null
}

export function isFirstSuperUserSetupPath(pathname: string): boolean {
    try {
        return /^\/+setup\/*$/i.test(decodeURI(pathname))
    } catch {
        return false
    }
}
