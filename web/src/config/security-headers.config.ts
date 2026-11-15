export const CSP_MAX_WEBSOCKET_URL_LENGTH = 2048

export const CSP_NONCE_PATTERN =
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/

export const CSP_SECURITY_CONFIG = {
    nonceBytes: 32,
    maximumPolicyLength: 4096,
    sharedDirectives: [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src-attr 'none'",
    ],
    connectOrigins: [
        'https://photon.komoot.io',
        'https://nominatim.openstreetmap.org',
    ],
} as const

export const DEFAULT_SECURITY_HEADERS = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy':
        'camera=(), microphone=(), geolocation=(), payment=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
} as const
