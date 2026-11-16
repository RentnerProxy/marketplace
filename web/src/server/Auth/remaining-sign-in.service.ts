import { eq } from 'drizzle-orm'
import { passkeyCredentials } from '@/db/schema.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { getConfiguredSocialProvidersService } from './Social/config.service.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

// Call only after locking the user through fresh reauthentication proof validation.
// A stored password hash alone cannot distinguish a known password from a placeholder.
export async function hasRemainingSignInMethodService(
    transaction: DatabaseTransaction,
    input: {
        userId: string
        excludedProvider?: SocialProviderId
        excludedPasskeyId?: string
    },
) {
    const linked = await transaction
        .select({ provider: socialAccounts.provider })
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, input.userId))
    const configured = getConfiguredSocialProvidersService()
    if (
        linked.some(
            (account) =>
                account.provider !== input.excludedProvider &&
                configured.some((provider) => provider.id === account.provider),
        )
    )
        return true
    const passkeys = await transaction
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, input.userId))
    const excludedPasskeyId = input.excludedPasskeyId?.toLowerCase()
    return passkeys.some((passkey) => passkey.id.toLowerCase() !== excludedPasskeyId)
}
