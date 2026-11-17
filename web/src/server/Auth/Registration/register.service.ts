import { randomBytes } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import {
    accountIdentityMatchesService,
    hasStaffIdentityReservationInTransactionService,
    lockAccountUniquenessInTransactionService,
} from '@/server/Auth/accountUniqueness.service.ts'
import { db } from '@/db'
import { users } from '@/db/Schema/users.ts'
import { pendingRegistrations } from '@/db/Schema/registration.ts'
import { REGISTRATION_POLICY } from '@/config/security.config.ts'
import type {
    RegistrationInput,
    RegistrationResult,
} from '@/features/Auth/Register/Types/registration.types.ts'
import { createPublicAccountInTransactionService } from './account.service.ts'
import {
    createRegistrationLinkService,
    createRegistrationTokenService,
} from './token.service.ts'
import {
    getSocialRegistrationIdentityService,
    consumeSocialRegistrationIdentityInTransactionService,
    clearSocialRegistrationCookieService,
} from '@/server/Auth/Social/registration.service.ts'
import { signInSocialIdentityService } from '@/server/Auth/Social/login.service.ts'
import { enqueueRegistrationVerificationMail } from '@/server/Queues/mail.queue.ts'
import { publishCommittedAuditLogService } from '@/lib/AuditLogs/auditLogs.ts'
import { logError } from '@/server/Logging/logger.ts'

export async function registerService(
    data: RegistrationInput,
): Promise<RegistrationResult> {
    const identity = await getSocialRegistrationIdentityService()
    const password = identity
        ? randomBytes(64).toString('base64url')
        : data.password
    if (!password)
        return { success: false, error: 'registration.passwordRequired' }
    const passwordHash = await Bun.password.hash(password)
    const terms = {
        termsVersion: REGISTRATION_POLICY.termsVersion,
        acceptedAt: new Date(),
    }
    const account = {
        username: data.username,
        email: data.email,
        passwordHash,
        ...terms,
        ...(identity
            ? { provider: identity.provider, subject: identity.subject }
            : {}),
    }
    if (
        identity?.emailVerified &&
        identity.email?.toLowerCase() === data.email
    ) {
        const created = await db.transaction(async (transaction) => {
            await lockAccountUniquenessInTransactionService(transaction)
            if (
                !(await consumeSocialRegistrationIdentityInTransactionService(
                    transaction,
                    identity.requestId,
                ))
            )
                throw new Error('Social registration expired')
            return createPublicAccountInTransactionService(transaction, account)
        })
        clearSocialRegistrationCookieService()
        if (!created) return { success: true, requiresEmailVerification: true }
        await publishCommittedAuditLogService(created.auditReceipt)
        try {
            const login = await signInSocialIdentityService(identity)
            return {
                success: true,
                requiresEmailVerification: false,
                redirectTo:
                    login.kind === 'success' ? login.redirectTo : '/login',
            }
        } catch (error) {
            logError('auth.registration.session_failed', error)
            return {
                success: true,
                requiresEmailVerification: false,
                redirectTo: '/login',
            }
        }
    }
    const { token, tokenHash, expiresAt } =
        await createRegistrationTokenService()
    const staged = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        const initialized = await transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(users.isDeleted, false))
            .limit(1)
        if (!initialized.at(0))
            throw new Error('Public registration requires completed bootstrap')
        await transaction
            .delete(pendingRegistrations)
            .where(lt(pendingRegistrations.expiresAt, new Date()))
        const duplicates = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.isDeleted, false),
                    accountIdentityMatchesService(data),
                ),
            )
            .limit(1)
        if (
            duplicates.at(0) ||
            (await hasStaffIdentityReservationInTransactionService(
                transaction,
                data,
            ))
        )
            return false
        if (
            identity &&
            !(await consumeSocialRegistrationIdentityInTransactionService(
                transaction,
                identity.requestId,
            ))
        )
            throw new Error('Social registration expired')
        await transaction
            .insert(pendingRegistrations)
            .values({ ...account, tokenHash, expiresAt })
        return true
    })
    if (identity && staged) clearSocialRegistrationCookieService()
    if (staged) {
        try {
            await enqueueRegistrationVerificationMail({
                to: data.email,
                username: data.username,
                resetLink: createRegistrationLinkService(
                    process.env.ORIGIN ?? 'http://localhost:3000',
                    token,
                ),
            })
        } catch (error) {
            logError('auth.registration.enqueue_failed', error)
            await db
                .delete(pendingRegistrations)
                .where(eq(pendingRegistrations.tokenHash, tokenHash))
            return { success: false, error: 'registration.failed' }
        }
    }
    return { success: true, requiresEmailVerification: true }
}
