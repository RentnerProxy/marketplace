export const PASSWORD_POLICY = {
    minimumNewLength: 4,
    maximumLength: 1024,
} as const

export const TOTP_POLICY = {
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    window: 1,
} as const

export const REAUTHENTICATION_PROOF_DURATION_MS = 60_000

export const TWO_FACTOR_SETUP_DURATION_MS = 5 * 60_000

export const LOGIN_RECOVERY_POLICY = {
    durationMs: 5 * 60_000,
    maximumAttempts: 3,
} as const

export const LOGIN_ATTEMPT_POLICY = {
    leaseDurationMs: 30_000,
    maximumFailures: 3,
    lockDurationsSeconds: [30, 3 * 60, 15 * 60],
    historyTtlSeconds: 24 * 60 * 60,
    retentionMs: 24 * 60 * 60 * 1000 + 30_000,
} as const

export const RATE_LIMITS = {
    registrationIp: { limit: 10, windowMs: 60 * 60_000 },
    registrationAccount: { limit: 3, windowMs: 60 * 60_000 },
    registrationVerifyIp: { limit: 30, windowMs: 15 * 60_000 },
    socialStartIp: { limit: 30, windowMs: 15 * 60_000 },
    socialCallbackIp: { limit: 60, windowMs: 15 * 60_000 },
    socialTwoFactorIp: { limit: 30, windowMs: 15 * 60_000 },
    socialTwoFactorChallenge: { limit: 5, windowMs: 5 * 60_000 },
    sessionActivityIp: { limit: 120, windowMs: 60_000 },
    sessionActivitySession: { limit: 6, windowMs: 60_000 },
    loginIp: { limit: 50, windowMs: 15 * 60000 },
    passkeyBeginIp: { limit: 50, windowMs: 15 * 60000 },
    passkeyBegin: { limit: 20, windowMs: 15 * 60000 },
    passkeyFinishIp: { limit: 50, windowMs: 15 * 60000 },
    passkeyFinish: { limit: 20, windowMs: 15 * 60000 },
    passwordResetRequestIp: { limit: 20, windowMs: 60 * 60000 },
    passwordResetRequestAccount: { limit: 5, windowMs: 60 * 60000 },
    passwordResetValidateIp: { limit: 30, windowMs: 15 * 60000 },
    passwordResetFinishIp: { limit: 15, windowMs: 60 * 60000 },
    passwordResetFinish: { limit: 10, windowMs: 60 * 60000 },
    currentUserPasswordResetIp: { limit: 10, windowMs: 60 * 60000 },
    currentUserPasswordReset: { limit: 5, windowMs: 60 * 60000 },
    currentUserReauthenticationIp: { limit: 30, windowMs: 15 * 60000 },
    currentUserReauthenticationAccount: {
        limit: 10,
        windowMs: 15 * 60000,
    },
    adminPasswordResetIp: { limit: 20, windowMs: 60 * 60000 },
    adminPasswordResetTarget: { limit: 5, windowMs: 60 * 60000 },
    firstUserSetupIp: { limit: 20, windowMs: 60 * 60000 },
    firstUserSetup: { limit: 10, windowMs: 60 * 60000 },
    imageUpload: { limit: 20, windowMs: 60 * 60000 },
    currentUserSettingsBurst: { limit: 60, windowMs: 60000 },
    currentUserSettingsDaily: { limit: 300, windowMs: 24 * 60 * 60000 },
    systemSettingsMutationBurst: { limit: 30, windowMs: 60000 },
    systemSettingsMutationDaily: { limit: 200, windowMs: 24 * 60 * 60000 },
    adminDashboardRead: { limit: 120, windowMs: 60000 },
    adminDashboardLogsRead: { limit: 120, windowMs: 60000 },
    maintenanceExtensionRequest: { limit: 5, windowMs: 60 * 60000 },
    backupCreate: { limit: 5, windowMs: 60 * 60000 },
    backupDownload: { limit: 30, windowMs: 60 * 60000 },
    backupImport: { limit: 5, windowMs: 60 * 60000 },
} as const

export const REGISTRATION_POLICY = {
    minimumPasswordLength: PASSWORD_POLICY.minimumNewLength,
    verificationDurationMs: 60 * 60_000,
    termsVersion: '2026-11-16',
    minimumResponseMs: 750,
} as const

export const AUTH_ENUMERATION_PROTECTION = {
    loginMinimumResponseMs: 750,
    loginLockoutMinimumResponseMs: 2000,
    passwordResetMinimumResponseMs: 750,
} as const

export const FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS = 10 * 60
export const FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS = 15_000

export const PASSKEY_CHALLENGE_DURATION_MS = 5 * 60000

export const REJECTED_AUTHENTICATION_LIMITS = {
    windowMs: 60000,
    maximumCount: Number.MAX_SAFE_INTEGER,
} as const
