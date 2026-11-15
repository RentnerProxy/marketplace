import { z } from 'zod'

export const REJECTED_AUTHENTICATION_FLOWS = [
    'password_login',
    'passkey_login',
    'reauthentication',
] as const

export const REJECTED_AUTHENTICATION_REASONS = [
    'invalid_credentials',
    'invalid_two_factor',
    'inactive_account',
    'rate_limited',
    'account_locked',
    'attempts_busy',
    'account_lock_created',
    'invalid_challenge',
    'invalid_passkey',
    'stale_credentials',
    'invalid_session',
    'credential_method_mismatch',
    'stale_proof',
] as const

export const rejectedAuthenticationFlowSchema = z.enum(
    REJECTED_AUTHENTICATION_FLOWS,
)
export const rejectedAuthenticationReasonSchema = z.enum(
    REJECTED_AUTHENTICATION_REASONS,
)
