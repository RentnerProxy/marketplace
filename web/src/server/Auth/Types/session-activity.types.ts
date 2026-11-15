export type SessionActivityResult =
    { active: false } | { active: true; expiresAt: string }

export type ActiveSessionState = {
    isActive: boolean
    isDeleted: boolean
    expiresAt: Date
}
