export function createPasswordResetLinkService(
    origin: string,
    token: string,
): string {
    return `${origin}/password-reset#token=${encodeURIComponent(token)}`
}
