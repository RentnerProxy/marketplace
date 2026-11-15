import { passwordResetConfig } from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'

export async function createPasswordResetTokenService() {
    const token = crypto.randomUUID()
    const tokenHash = await createTokenHash(token)
    const expiresAt = new Date(Date.now() + passwordResetConfig.durationMs)

    return { token, tokenHash, expiresAt }
}
