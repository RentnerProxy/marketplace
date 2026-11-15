export function isPasswordResetPath(pathname: string): boolean {
    try {
        return /^\/+password-reset\/*$/i.test(decodeURI(pathname))
    } catch {
        return false
    }
}
