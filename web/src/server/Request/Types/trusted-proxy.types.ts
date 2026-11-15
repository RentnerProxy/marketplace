export type ParsedIpAddress = {
    bytes: Array<number>
    version: 4 | 6
}

export type TrustedProxyRange = ParsedIpAddress & {
    prefixLength: number
}

export type TrustedProxyRequest = {
    directIp?: string | null
    forwardedFor?: string | null
}
