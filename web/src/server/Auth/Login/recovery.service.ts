import {
    RESERVE_ATTEMPT_SCRIPT,
    CLAIM_ATTEMPT_SCRIPT,
} from './recovery.script.ts'
import { randomBytes } from 'node:crypto'
import {
    deleteCookie,
    getCookie,
    setCookie,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { LOGIN_RECOVERY_POLICY } from '@/config/security.config.ts'
import { LOGIN_RECOVERY_COOKIE_NAME } from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import type {
    IssueLoginRecoveryGrantInput,
    LoginRecoveryAttempt,
    LoginRecoveryGrant,
    LoginRecoveryUser,
} from '@/server/Auth/Types/login-recovery.types.ts'

const identitySchema = z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/)
const usernameSchema = z.string().trim().min(1).max(50)
const passwordHashSchema = z.string().min(1).max(1024)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const tokenSchema = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .refine(function (value) {
        const bytes = Buffer.from(value, 'base64url')
        return bytes.byteLength === 32 && bytes.toString('base64url') === value
    })
const issueInputSchema = z.strictObject({
    userId: identitySchema,
    username: usernameSchema,
    passwordHash: passwordHashSchema,
})
const userSchema = z.object({
    id: identitySchema,
    username: usernameSchema,
    passwordHash: passwordHashSchema,
})
const attemptSchema = z.strictObject({
    grantTokenHash: digestSchema,
    attemptId: tokenSchema,
})

function grantKey(tokenHash: string) {
    return `rentnerproxy-marketplace:login-recovery:v1:${tokenHash}`
}

function usernameHash(username: string) {
    return createTokenHash(
        JSON.stringify(['login-recovery-username-v1', username]),
    )
}

function passwordVersion(userId: string, passwordHash: string) {
    return createTokenHash(
        JSON.stringify(['login-recovery-password-v1', userId, passwordHash]),
    )
}

function acceptedValkeyResult(result: unknown) {
    if (result !== 0 && result !== 1)
        throw new Error('Unexpected login recovery response')
    return result === 1
}

export async function issueLoginRecoveryGrantService(
    input: IssueLoginRecoveryGrantInput,
): Promise<void> {
    const parsed = issueInputSchema.parse(input)
    const token = randomBytes(32).toString('base64url')
    const [grantTokenHash, normalizedUsernameHash, version] = await Promise.all(
        [
            createTokenHash(token),
            usernameHash(parsed.username),
            passwordVersion(parsed.userId, parsed.passwordHash),
        ],
    )
    const expiresAt = Date.now() + LOGIN_RECOVERY_POLICY.durationMs
    const grant: LoginRecoveryGrant = {
        purpose: 'login-recovery-v1',
        userId: parsed.userId,
        usernameHash: normalizedUsernameHash,
        passwordVersion: version,
        expiresAt,
        attemptIds: [],
    }
    const key = grantKey(grantTokenHash)
    const valkey = getValkeyConnection()
    const created = await valkey.set(
        key,
        JSON.stringify(grant),
        'PX',
        LOGIN_RECOVERY_POLICY.durationMs,
        'NX',
    )
    if (created !== 'OK')
        throw new Error('Login recovery grant could not be created')
    try {
        setCookie(LOGIN_RECOVERY_COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            expires: new Date(expiresAt),
            maxAge: Math.floor(LOGIN_RECOVERY_POLICY.durationMs / 1000),
        })
    } catch (error) {
        await valkey.del(key)
        throw error
    }
}

export async function reserveLoginRecoveryAttemptService(
    username: string,
): Promise<LoginRecoveryAttempt | null> {
    const parsedUsername = usernameSchema.safeParse(username)
    const parsedToken = tokenSchema.safeParse(
        getCookie(LOGIN_RECOVERY_COOKIE_NAME),
    )
    if (!parsedUsername.success || !parsedToken.success) return null
    const [grantTokenHash, normalizedUsernameHash] = await Promise.all([
        createTokenHash(parsedToken.data),
        usernameHash(parsedUsername.data),
    ])
    const attemptId = randomBytes(32).toString('base64url')
    const result = await getValkeyConnection().eval(
        RESERVE_ATTEMPT_SCRIPT,
        1,
        grantKey(grantTokenHash),
        normalizedUsernameHash,
        attemptId,
        String(LOGIN_RECOVERY_POLICY.maximumAttempts),
        String(LOGIN_RECOVERY_POLICY.durationMs),
    )
    return acceptedValkeyResult(result) ? { grantTokenHash, attemptId } : null
}

export async function claimLoginRecoveryAttemptService(
    attempt: LoginRecoveryAttempt,
    user: LoginRecoveryUser,
): Promise<boolean> {
    const parsedAttempt = attemptSchema.safeParse(attempt)
    const parsedUser = userSchema.safeParse(user)
    if (!parsedAttempt.success || !parsedUser.success) return false
    const [normalizedUsernameHash, version] = await Promise.all([
        usernameHash(parsedUser.data.username),
        passwordVersion(parsedUser.data.id, parsedUser.data.passwordHash),
    ])
    const result = await getValkeyConnection().eval(
        CLAIM_ATTEMPT_SCRIPT,
        1,
        grantKey(parsedAttempt.data.grantTokenHash),
        parsedAttempt.data.attemptId,
        parsedUser.data.id,
        normalizedUsernameHash,
        version,
        String(LOGIN_RECOVERY_POLICY.maximumAttempts),
        String(LOGIN_RECOVERY_POLICY.durationMs),
    )
    if (!acceptedValkeyResult(result)) return false
    deleteCookie(LOGIN_RECOVERY_COOKIE_NAME, { path: '/' })
    return true
}
