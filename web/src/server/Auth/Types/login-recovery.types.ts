export type LoginRecoveryAttempt = {
    grantTokenHash: string
    attemptId: string
}

export type LoginRecoveryUser = {
    id: string
    username: string
    passwordHash: string
}

export type IssueLoginRecoveryGrantInput = {
    userId: string
    username: string
    passwordHash: string
}

export type LoginRecoveryGrant = {
    purpose: 'login-recovery-v1'
    userId: string
    usernameHash: string
    passwordVersion: string
    expiresAt: number
    attemptIds: Array<string>
}
