import { randomBytes } from 'node:crypto'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { REGISTRATION_POLICY } from '@/config/security.config.ts'

export async function createRegistrationTokenService() {
    const token = randomBytes(32).toString('base64url')
    return {
        token,
        tokenHash: await createTokenHash(token),
        expiresAt: new Date(
            Date.now() + REGISTRATION_POLICY.verificationDurationMs,
        ),
    }
}

export function createRegistrationLinkService(origin: string, token: string) {
    const url = new URL('/register', origin)
    url.hash = `verify=${token}`
    return url.toString()
}
