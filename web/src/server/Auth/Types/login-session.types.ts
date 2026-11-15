import type { users } from '@/db/schema.ts'

type AuthenticatedLoginUser = Pick<
    typeof users.$inferSelect,
    | 'id'
    | 'username'
    | 'email'
    | 'isActive'
    | 'passwordHash'
    | 'isTwoFactorEnabled'
>

export type AuthenticatedLoginProof =
    | {
          kind: 'password'
          trustThisDevice: boolean
          factorId: string | null
      }
    | {
          kind: 'passkey'
          passkeyId: string
          counter: number
          newCounter: number
      }

export type CreateAuthenticatedSessionInput = {
    user: AuthenticatedLoginUser
    proof: AuthenticatedLoginProof
    auditAction: string
    auditMessage: string
}

type AuthenticatedSessionUser = Pick<
    typeof users.$inferSelect,
    'id' | 'username' | 'email' | 'isActive'
> & { permissions: string[] }

export type CreateAuthenticatedSessionResult =
    | {
          success: false
          code: 'INVALID_CREDENTIALS'
          error: string
          requiresTwoFactor?: never
      }
    | {
          success: true
          redirectTo: string
          user: AuthenticatedSessionUser
          loggedOutDueToMissingPermissions?: boolean
          error?: string
      }

export type PreparedLoginToken = {
    token: string
    hash: string
    expiresAt: Date
}
