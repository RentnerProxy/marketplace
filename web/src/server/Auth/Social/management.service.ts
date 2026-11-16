import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { getConfiguredSocialProvidersService } from './config.service.ts'
import { SOCIAL_PROVIDERS } from '@/config/social-auth.config.ts'
import type { SocialProvider, SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export async function getCurrentUserSocialAccountsService(): Promise<{
    providers: SocialProvider[]
    accounts: Array<{ id: string; provider: SocialProviderId; createdAt: Date }>
}> {
    const currentUser = await getActiveCurrentSessionUser()
    if (!currentUser) throw new AuthenticationRequiredError()
    const rows = await db.select({
        id: socialAccounts.id,
        provider: socialAccounts.provider,
        createdAt: socialAccounts.createdAt,
    }).from(socialAccounts).where(eq(socialAccounts.userId, currentUser.id))
        .orderBy(desc(socialAccounts.createdAt))
    const accounts = rows.flatMap((account) => {
        const provider = SOCIAL_PROVIDERS.find((candidate) => candidate.id === account.provider)
        return provider ? [{ ...account, provider: provider.id }] : []
    })
    return { providers: getConfiguredSocialProvidersService(), accounts }
}
