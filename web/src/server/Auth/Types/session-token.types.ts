export type ParsedSessionToken = {
    token: string
    issuedAtMs: number
    absoluteExpiresAt: Date
}

export type SessionTokenCandidate = {
    sessionHash: string
    issuedAtMs: number
    absoluteExpiresAt: Date
}

export type PreparedAuthenticatedSessionToken = {
    token: string
    hash: string
    expiresAt: Date
    absoluteExpiresAt: Date
}
