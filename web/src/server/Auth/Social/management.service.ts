import { and, desc, eq, ne } from 'drizzle-orm'
import { sessions } from '@/db/schema.ts'
import { hasRemainingSignInMethodService } from '@/server/Auth/remaining-sign-in.service.ts'
import { publishSessionRevokedService } from '@/server/Realtime/publish.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'
import { validateReauthenticationProofService } from '@/server/Auth/reauthentication-proof.service.ts'
import { prepareAuditContextService, publishCommittedAuditLogService, writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import type { CurrentUserReauthenticationInput } from '@/features/UserSettings/Types/user-settings-server-input.types.ts'
import { db } from '@/db'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { getConfiguredSocialProvidersService } from './config.service.ts'
import { SOCIAL_PROVIDERS } from '@/config/social-auth.config.ts'
import type {
    SocialProvider,
    SocialProviderId,
} from '@/lib/Auth/Types/social-auth.types.ts'

export async function getCurrentUserSocialAccountsService(): Promise<{
    providers: SocialProvider[]
    accounts: Array<{ id: string; provider: SocialProviderId; createdAt: Date }>
}> {
    const currentUser = await getActiveCurrentSessionUser()
    if (!currentUser) throw new AuthenticationRequiredError()
    const rows = await db
        .select({
            id: socialAccounts.id,
            provider: socialAccounts.provider,
            createdAt: socialAccounts.createdAt,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, currentUser.id))
        .orderBy(desc(socialAccounts.createdAt))
    const accounts = rows.flatMap((account) => {
        const provider = SOCIAL_PROVIDERS.find(
            (candidate) => candidate.id === account.provider,
        )
        return provider ? [{ ...account, provider: provider.id }] : []
    })
    return { providers: getConfiguredSocialProvidersService(), accounts }
}

export async function unlinkCurrentUserSocialAccountService(data: {
    provider: SocialProviderId
    reauthentication: CurrentUserReauthenticationInput
}) {
    const confirmation = await reauthenticateCurrentUserService(data.reauthentication)
    if (!confirmation.success) return confirmation
    const auditContext = prepareAuditContextService(confirmation.currentUser.id)
    const result = await db.transaction(async (transaction) => {
        const state = await validateReauthenticationProofService(transaction, confirmation.proof)
        if (!state || state.currentUser.id !== confirmation.currentUser.id)
            return { success: false as const, error: 'auth.social.confirmation_failed' }
        const linked = await transaction.select({ id: socialAccounts.id, provider: socialAccounts.provider })
            .from(socialAccounts).where(eq(socialAccounts.userId, state.currentUser.id))
        const target = linked.find((account) => account.provider === data.provider)
        if (!target) return { success: false as const, error: 'auth.social.not_linked' }
        // A random placeholder hash is also stored for provider-created users.
        // Only a successful password confirmation proves that password is usable.
        if (data.reauthentication.method !== 'password' && !(await hasRemainingSignInMethodService(transaction, { userId: state.currentUser.id, excludedProvider: data.provider })))
            return { success: false as const, error: 'auth.social.last_method' }
        const deleted = await transaction.delete(socialAccounts)
            .where(and(eq(socialAccounts.id, target.id), eq(socialAccounts.userId, state.currentUser.id)))
            .returning({ id: socialAccounts.id })
        if (deleted.length !== 1) return { success: false as const, error: 'auth.social.not_linked' }
        const revokedSessions = await transaction.delete(sessions).where(and(eq(sessions.userId, state.currentUser.id), ne(sessions.id, state.sessionHash))).returning({ id: sessions.id })
        const auditReceipt = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'auth.social_account_unlinked',
            message: `Anmeldeanbieter ${data.provider} wurde getrennt.`,
            newValues: { provider: data.provider, sessionsRevoked: 'other' },
        })
        return { success: true as const, auditReceipt, revokedSessions }
    })
    if (!result.success) return result
    await publishCommittedAuditLogService(result.auditReceipt)
    await Promise.all(result.revokedSessions.map(async (session) => {
        try {
            await publishSessionRevokedService({ userId: confirmation.currentUser.id, sessionHash: session.id, revokedAt: result.auditReceipt.createdAt.toISOString() })
        } catch (error) {
            logError('auth.social.unlink_realtime_revoke_failed', error, { auditLogId: result.auditReceipt.id })
        }
    }))
    return { success: true as const }
}
