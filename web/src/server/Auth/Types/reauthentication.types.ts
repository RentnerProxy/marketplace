import type { db } from '@/db'

export type ReauthenticationCredentialUser = {
    id: string
    passwordHash: string
    isTwoFactorEnabled: boolean
}

export type ReauthenticationProof = {
    userId: string
    sessionHash: string
    credentialVersion: string
    expiresAt: number
}

export type ReauthenticationSessionIdentity = Pick<
    ReauthenticationProof,
    'userId' | 'sessionHash'
>

export type LockedReauthenticationState = {
    currentUser: {
        id: string
        username: string
        email: string
        isTwoFactorEnabled: boolean
    }
    sessionHash: string
    credentialVersion: string
    factorId: string | null
}

export type ReauthenticationTransaction = Parameters<
    Parameters<typeof db.transaction>[0]
>[0]
