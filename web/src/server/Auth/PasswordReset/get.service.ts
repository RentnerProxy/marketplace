import { db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema.ts'
import { and, eq, gt } from 'drizzle-orm'
import { createTokenHash } from '@/lib/Auth/tokens.ts'

export async function validatePasswordResetTokenService(token: string) {
    const tokenHash = await createTokenHash(token)
    const tokens = await db
        .select({ tokenHash: passwordResetTokens.tokenHash })
        .from(passwordResetTokens)
        .innerJoin(users, eq(users.id, passwordResetTokens.userId))
        .where(
            and(
                eq(passwordResetTokens.tokenHash, tokenHash),
                gt(passwordResetTokens.expiresAt, new Date()),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
            ),
        )
        .limit(1)

    return {
        valid: tokens.length === 1,
        length: tokens.length,
    }
}
