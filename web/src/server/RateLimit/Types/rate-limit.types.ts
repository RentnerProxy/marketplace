export type RateLimitOptions = {
    scope: string
    identifiers?: Array<string | null | undefined>
    includeClientIp?: boolean
    limit: number
    windowMs: number
}
