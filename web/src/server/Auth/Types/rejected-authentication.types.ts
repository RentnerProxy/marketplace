import type {
    REJECTED_AUTHENTICATION_FLOWS,
    REJECTED_AUTHENTICATION_REASONS,
} from '@/lib/Auth/rejectedAuthentication.ts'

export type RejectedAuthenticationFlow =
    (typeof REJECTED_AUTHENTICATION_FLOWS)[number]

export type RejectedAuthenticationReason =
    (typeof REJECTED_AUTHENTICATION_REASONS)[number]

export type RejectedAuthenticationWindow = {
    endsAt: number | null
    additionalCount: number
    timer: symbol | null
}
