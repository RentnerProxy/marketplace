export const SESSION_COOKIE_NAME = 'session_id'
export const LOGIN_RECOVERY_COOKIE_NAME = 'login_recovery'
export const TRUSTED_DEVICE_COOKIE_NAME = 'trusted_device_token'

export const SESSION_TOKEN_VERSION = 's1'
export const SESSION_TOKEN_RANDOM_BYTES = 32

export const sessionConfig = {
    absoluteDurationMs: 8 * 60 * 60_000,
    idleDurationMs: 15 * 60_000,
    activityThrottleMs: 60_000,
    activityReadRetryLimit: 2,
    activityRequestTimeoutMs: 15_000,
} as const

export const trustedDeviceConfig = {
    durationMs: 1000 * 60 * 60 * 24 * 30,
}

export const passwordResetConfig = {
    durationMs: 1000 * 60 * 60,
    maximumTokenLength: 255,
    maximumLegacyQueryLength: 4096,
    requestTimeoutMs: 15_000,
} as const

export const userInvitationConfig = {
    durationMs: 1000 * 60 * 60 * 24,
}
