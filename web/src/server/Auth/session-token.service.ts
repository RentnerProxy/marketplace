import { Buffer } from 'node:buffer'
import {
    SESSION_TOKEN_VERSION,
    SESSION_TOKEN_RANDOM_BYTES,
    sessionConfig,
} from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type {
    ParsedSessionToken,
    PreparedAuthenticatedSessionToken,
    SessionTokenCandidate,
} from './Types/session-token.types.ts'

function isValidTimestamp(value: number): boolean {
    return (
        Number.isSafeInteger(value) &&
        value > 0 &&
        Number.isFinite(
            new Date(value + sessionConfig.absoluteDurationMs).getTime(),
        )
    )
}

export function parseSessionTokenService(
    value: unknown,
    nowMs = Date.now(),
): ParsedSessionToken | null {
    if (
        typeof value !== 'string' ||
        value.length > 63 ||
        !isValidTimestamp(nowMs)
    ) {
        return null
    }
    const parts = value.split('.')
    if (
        parts.length !== 3 ||
        parts[0] !== SESSION_TOKEN_VERSION ||
        !/^[1-9]\d{0,15}$/.test(parts[1]) ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
    ) {
        return null
    }
    const issuedAtMs = Number(parts[1])
    if (
        !isValidTimestamp(issuedAtMs) ||
        String(issuedAtMs) !== parts[1] ||
        issuedAtMs > nowMs ||
        issuedAtMs + sessionConfig.absoluteDurationMs <= nowMs
    ) {
        return null
    }
    const randomBytes = Buffer.from(parts[2], 'base64url')
    if (
        randomBytes.length !== SESSION_TOKEN_RANDOM_BYTES ||
        randomBytes.toString('base64url') !== parts[2]
    ) {
        return null
    }
    return {
        token: value,
        issuedAtMs,
        absoluteExpiresAt: new Date(
            issuedAtMs + sessionConfig.absoluteDurationMs,
        ),
    }
}

export async function getSessionTokenCandidateService(
    value: unknown,
): Promise<SessionTokenCandidate | null> {
    const parsed = parseSessionTokenService(value)
    if (!parsed) return null
    const sessionHash = await createTokenHash(parsed.token)
    const nowMs = Date.now()
    if (
        !isValidTimestamp(nowMs) ||
        nowMs < parsed.issuedAtMs ||
        nowMs >= parsed.absoluteExpiresAt.getTime()
    ) {
        return null
    }

    return {
        sessionHash,
        issuedAtMs: parsed.issuedAtMs,
        absoluteExpiresAt: parsed.absoluteExpiresAt,
    }
}

export async function createSessionTokenService(
    nowMs = Date.now(),
): Promise<PreparedAuthenticatedSessionToken> {
    if (!isValidTimestamp(nowMs)) throw new Error('Invalid session issue time.')
    const entropy = crypto.getRandomValues(
        new Uint8Array(SESSION_TOKEN_RANDOM_BYTES),
    )
    const token =
        SESSION_TOKEN_VERSION +
        '.' +
        nowMs +
        '.' +
        Buffer.from(entropy).toString('base64url')
    return {
        token,
        hash: await createTokenHash(token),
        expiresAt: new Date(nowMs + sessionConfig.idleDurationMs),
        absoluteExpiresAt: new Date(nowMs + sessionConfig.absoluteDurationMs),
    }
}
