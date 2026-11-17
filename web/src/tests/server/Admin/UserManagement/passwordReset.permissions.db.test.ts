import type { Mock } from 'bun:test'
import { eq, inArray, like } from 'drizzle-orm'
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import { db } from '@/db'
import {
    passwordResetTokens,
    permissions,
    publicAccounts,
    staffAccounts,
    staffUserPermissions,
    users,
} from '@/db/schema.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'
import { resetUserPasswordService } from '@/server/Admin/UserManagement/password.service.ts'

const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])test(?:[_-]|$)/i
const TEST_RUN_ID = crypto.randomUUID()
const TEST_EMAIL_PREFIX = `test-db-admin-reset+${TEST_RUN_ID}-`
const insertedPermissionIds = new Set<string>()

const serviceState = (function () {
    return { currentUserId: null as string | null }
})()

const serviceMocks = (function () {
    return {
        enqueuePasswordResetMail: vi.fn(async function () {}),
        getCurrentSessionUserId: vi.fn(async function () {
            return serviceState.currentUserId
        }),
        writeAuditLogInTransactionService: vi.fn(async function () {
            return {
                id: 'synthetic-audit-receipt',
                createdAt: new Date('2026-09-06T00:00:00.000Z'),
            }
        }),
    }
})()

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getCurrentSessionUserId: serviceMocks.getCurrentSessionUserId,
    }
})

vi.mock('@/server/Queues/mail.queue.ts', function () {
    return {
        enqueuePasswordResetMail: serviceMocks.enqueuePasswordResetMail,
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService: (actorUserId: string | null) => ({
            actorUserId,
            route: null,
            method: 'POST',
        }),
        writeAuditLogInTransactionService:
            serviceMocks.writeAuditLogInTransactionService,
        publishCommittedAuditLogService: vi.fn(async function () {}),
    }
})

const mockedEnqueuePasswordResetMail = enqueuePasswordResetMail as Mock<
    typeof enqueuePasswordResetMail
>
const mockedWriteAuditLog = writeAuditLogInTransactionService as Mock<
    typeof writeAuditLogInTransactionService
>

function requireIsolatedTestDatabaseUrl() {
    const value = process.env.TEST_DATABASE_URL?.trim()

    if (!value) {
        throw new Error(
            'DB-Integrationstests benötigen eine explizite TEST_DATABASE_URL.',
        )
    }

    const databaseUrl = new URL(value)
    const databaseName = decodeURIComponent(databaseUrl.pathname).replace(
        /^\/+/,
        '',
    )

    if (
        !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
        !TEST_DATABASE_NAME_PATTERN.test(databaseName)
    ) {
        throw new Error(
            'TEST_DATABASE_URL muss auf eine eindeutig benannte PostgreSQL-Testdatenbank zeigen.',
        )
    }
}

async function cleanupAdminResetUsers() {
    await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`))
}

async function createTestUser(role: string) {
    const accountType = role === 'target' ? 'public' : 'staff'
    const suffix = crypto.randomUUID()
    const insertedUsers = await db
        .insert(users)
        .values({
            accountType,
            username: `test-db-${role}-${suffix}`.slice(0, 50),
            email: `${TEST_EMAIL_PREFIX}${role}-${suffix}@example.com`,
            passwordHash: 'test-only-placeholder-hash',
            isActive: true,
        })
        .returning({ id: users.id })
    const userId = insertedUsers.at(0)?.id

    if (!userId) {
        throw new Error('Permission-Testbenutzer konnte nicht angelegt werden.')
    }

    await db
        .insert(accountType === 'staff' ? staffAccounts : publicAccounts)
        .values({ userId })
    return userId
}

async function ensurePermission(permissionKey: string) {
    const existingPermissions = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, permissionKey))
        .limit(1)
    const existingPermissionId = existingPermissions.at(0)?.id

    if (existingPermissionId) {
        return existingPermissionId
    }

    const insertedPermissions = await db
        .insert(permissions)
        .values({
            key: permissionKey,
            name: `DB-Test ${permissionKey}`,
            description: 'Temporäre Berechtigung für isolierte DB-Tests.',
        })
        .returning({ id: permissions.id })
    const insertedPermissionId = insertedPermissions.at(0)?.id

    if (!insertedPermissionId) {
        throw new Error('Testberechtigung konnte nicht angelegt werden.')
    }

    insertedPermissionIds.add(insertedPermissionId)
    return insertedPermissionId
}

async function assignPermission(userId: string, permissionKey: string) {
    await db.insert(staffUserPermissions).values({
        userId,
        permissionId: await ensurePermission(permissionKey),
    })
}

async function createExistingResetToken(userId: string) {
    const rawToken = crypto.randomUUID()
    const tokenHash = await createTokenHash(rawToken)

    await db.insert(passwordResetTokens).values({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60000),
    })

    return { rawToken, tokenHash }
}

async function getStoredResetTokenHashes(userId: string) {
    return db
        .select({ tokenHash: passwordResetTokens.tokenHash })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId))
}

describe('resetUserPasswordService Permission-DB-Integration', function () {
    beforeEach(function () {
        requireIsolatedTestDatabaseUrl()
        vi.clearAllMocks()
        serviceState.currentUserId = null
    })

    afterEach(async function () {
        await cleanupAdminResetUsers()
    })

    afterAll(async function () {
        await cleanupAdminResetUsers()

        if (insertedPermissionIds.size > 0) {
            await db
                .delete(permissions)
                .where(inArray(permissions.id, [...insertedPermissionIds]))
        }
    })

    it('ersetzt den Token nur nach erfolgreicher Permission-Revalidierung in der Transaktion', async function () {
        const actorUserId = await createTestUser('admin')
        const targetUserId = await createTestUser('target')
        const previousToken = await createExistingResetToken(targetUserId)
        await assignPermission(actorUserId, PERMISSIONS.ADMIN_USER_MANAGEMENT)
        serviceState.currentUserId = actorUserId

        const result = await resetUserPasswordService({
            id: targetUserId,
            accountType: 'public',
        })
        const storedTokens = await getStoredResetTokenHashes(targetUserId)
        const mailPayload = mockedEnqueuePasswordResetMail.mock.calls
            .at(0)
            ?.at(0)
        const rawToken = mailPayload
            ? new URLSearchParams(
                  new URL(mailPayload.resetLink).hash.slice(1),
              ).get('token')
            : null

        expect(result).toEqual({ success: true })
        expect(storedTokens).toHaveLength(1)
        expect(storedTokens[0]?.tokenHash).not.toBe(previousToken.tokenHash)
        expect(rawToken).toBeTruthy()

        if (!rawToken) {
            throw new Error('Reset-Mail enthält kein Token.')
        }

        expect(storedTokens[0]?.tokenHash).toBe(await createTokenHash(rawToken))
        expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
    })

    it('lässt den vorhandenen Token bei zwischenzeitlichem Berechtigungsentzug unverändert', async function () {
        const actorUserId = await createTestUser('former-admin')
        const targetUserId = await createTestUser('target')
        const previousToken = await createExistingResetToken(targetUserId)
        serviceState.currentUserId = actorUserId

        const result = await resetUserPasswordService({
            id: targetUserId,
            accountType: 'public',
        })

        expect(result).toEqual({
            success: false,
            error: 'Dir fehlt die erforderliche Berechtigung.',
        })
        expect(await getStoredResetTokenHashes(targetUserId)).toEqual([
            { tokenHash: previousToken.tokenHash },
        ])
        expect(mockedEnqueuePasswordResetMail).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
    })

    it('verhindert den Reset eines Superusers durch einen normalen Admin', async function () {
        const actorUserId = await createTestUser('admin')
        const targetUserId = await createTestUser('superuser')
        const previousToken = await createExistingResetToken(targetUserId)
        await assignPermission(actorUserId, PERMISSIONS.ADMIN_USER_MANAGEMENT)
        await assignPermission(targetUserId, PERMISSIONS.ADMIN_SUPER_USER)
        serviceState.currentUserId = actorUserId

        const result = await resetUserPasswordService({
            id: targetUserId,
            accountType: 'staff',
        })

        expect(result).toEqual({
            success: false,
            error: 'Dir fehlt die erforderliche Berechtigung.',
        })
        expect(await getStoredResetTokenHashes(targetUserId)).toEqual([
            { tokenHash: previousToken.tokenHash },
        ])
        expect(mockedEnqueuePasswordResetMail).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
    })
})
