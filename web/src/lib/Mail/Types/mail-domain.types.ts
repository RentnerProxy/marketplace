import type { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'

export type AuthMailInput = {
    to: string
    username: string
    resetLink: string
}

export type AuthMailMessageInput = AuthMailInput & {
    subject: string
    headline: string
    intro: string
}

export type FailedLoginAlertMailInput = {
    to: string
    username: string
    ip: string | null
    location: string | null
    device: string | null
    browser: string | null
    attemptedAt: string
    mapsLink: string | null
}

type SecurityChangeType = (typeof SECURITY_CHANGE_TYPES)[number]

export type SecurityChangeMailInput = {
    to: string
    change: SecurityChangeType
    changedAt: string
    auditEventId: string
}
