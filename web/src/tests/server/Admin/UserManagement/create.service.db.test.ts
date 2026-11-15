import type { Mock } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, inArray, like } from 'drizzle-orm'
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import { db } from '@/db'
import {
    restoreBunProperties,
    stubBunProperties,
} from '@/tests/shared/bunTestStubs.ts'
import {
    defaultUserPermissions,
    passwordResetTokens,
    permissions,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { enqueuePasswordSetupMail } from '@/server/Queues/mail.queue.ts'
import { createUserService } from '@/server/Admin/UserManagement/create.service.ts'

const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])test(?:[_-]|$)/i
const TEST_RUN_ID = crypto.randomUUID()
const TEST_CREATOR_EMAIL = `test-db-creator+${TEST_RUN_ID}@example.com`
const TEST_CREATED_EMAIL_PREFIX = `test-db-created+${TEST_RUN_ID}-`
const execFileAsync = promisify(execFile)
const BUN_EXECUTABLE = process.env.npm_execpath ?? 'bun'

const serviceState = (function () {
    return { currentUserId: null as string | null }
})()

const serviceMocks = (function () {
    return {
        enqueuePasswordSetupMail: vi.fn(async function () {}),
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
        enqueuePasswordSetupMail: serviceMocks.enqueuePasswordSetupMail,
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

const mockedEnqueuePasswordSetupMail = enqueuePasswordSetupMail as Mock<
    typeof enqueuePasswordSetupMail
>
const mockedWriteAuditLog = writeAuditLogInTransactionService as Mock<
    typeof writeAuditLogInTransactionService
>
let creatorUserId: string | null = null
const insertedPermissionIds = new Set<string>()
let addedDefaultPermissionId: string | null = null

async function createBunPasswordHash(password: string) {
    const { stdout } = await execFileAsync(BUN_EXECUTABLE, [
        '-e',
        'console.log(await Bun.password.hash(Bun.argv[1]))',
        password,
    ])

    return stdout.trim()
}

function installBunPasswordBridge() {
    stubBunProperties({
        password: { hash: createBunPasswordHash },
    })
}

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

async function cleanupCreatedUsers() {
    await db
        .delete(users)
        .where(like(users.email, `${TEST_CREATED_EMAIL_PREFIX}%`))
}

async function ensurePermission(permissionKey: string) {
    const existingPermissionRows = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, permissionKey))
        .limit(1)
    const existingPermissionId = existingPermissionRows.at(0)?.id

    if (existingPermissionId) {
        return existingPermissionId
    }

    const insertedPermissionRows = await db
        .insert(permissions)
        .values({
            key: permissionKey,
            name: `DB-Test ${permissionKey}`,
            description: 'Nur für den isolierten DB-Test.',
        })
        .returning({ id: permissions.id })
    const permissionId = insertedPermissionRows.at(0)?.id

    if (!permissionId) {
        throw new Error('DB-Test-Recht konnte nicht angelegt werden.')
    }

    insertedPermissionIds.add(permissionId)
    return permissionId
}

describe('createUserService DB-Integration', function () {
    beforeAll(async function () {
        requireIsolatedTestDatabaseUrl()
        installBunPasswordBridge()

        const insertedCreators = await db
            .insert(users)
            .values({
                username: `test-db-creator-${TEST_RUN_ID}`.slice(0, 50),
                email: TEST_CREATOR_EMAIL,
                passwordHash: 'test-only-placeholder-hash',
                isActive: true,
            })
            .returning({ id: users.id })

        creatorUserId = insertedCreators.at(0)?.id ?? null

        if (!creatorUserId) {
            throw new Error('DB-Test-Ersteller konnte nicht angelegt werden.')
        }

        serviceState.currentUserId = creatorUserId

        const userManagementPermissionId = await ensurePermission(
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        )
        const userDashboardPermissionId = await ensurePermission(
            PERMISSIONS.USER_DASHBOARD,
        )

        await db.insert(userPermissions).values({
            userId: creatorUserId,
            permissionId: userManagementPermissionId,
        })

        const existingDefaultRows = await db
            .select({ permissionId: defaultUserPermissions.permissionId })
            .from(defaultUserPermissions)
            .where(
                eq(
                    defaultUserPermissions.permissionId,
                    userDashboardPermissionId,
                ),
            )

        if (existingDefaultRows.length === 0) {
            await db.insert(defaultUserPermissions).values({
                permissionId: userDashboardPermissionId,
            })
            addedDefaultPermissionId = userDashboardPermissionId
        }
    })

    beforeEach(function () {
        vi.clearAllMocks()
    })

    afterEach(async function () {
        await cleanupCreatedUsers()
    })

    afterAll(async function () {
        try {
            await cleanupCreatedUsers()

            if (creatorUserId) {
                await db.delete(users).where(eq(users.id, creatorUserId))
            }

            if (addedDefaultPermissionId) {
                await db
                    .delete(defaultUserPermissions)
                    .where(
                        eq(
                            defaultUserPermissions.permissionId,
                            addedDefaultPermissionId,
                        ),
                    )
            }

            if (insertedPermissionIds.size > 0) {
                await db
                    .delete(permissions)
                    .where(inArray(permissions.id, [...insertedPermissionIds]))
            }
        } finally {
            restoreBunProperties()
        }
    })

    it('persistiert Benutzer, Profil und nur den Hash des Einladungs-Tokens atomar', async function () {
        const suffix = crypto.randomUUID()
        const username = `test-db-created-${suffix}`.slice(0, 50)
        const normalizedEmail = `${TEST_CREATED_EMAIL_PREFIX}${suffix}@example.com`

        const result = await createUserService({
            username: `  ${username}  `,
            email: normalizedEmail.toUpperCase(),
        })

        expect(result.success).toBe(true)

        if (!result.success) {
            throw new Error(result.error)
        }

        const storedUsers = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                createdByUserId: users.createdByUserId,
            })
            .from(users)
            .where(eq(users.id, result.user.id))
            .limit(1)
        const storedProfiles = await db
            .select({ userId: user_profiles.userId })
            .from(user_profiles)
            .where(eq(user_profiles.userId, result.user.id))
        const storedTokens = await db
            .select({ tokenHash: passwordResetTokens.tokenHash })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, result.user.id))
        const storedPermissionRows = await db
            .select({ key: permissions.key })
            .from(userPermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, userPermissions.permissionId),
            )
            .where(eq(userPermissions.userId, result.user.id))
        const mailPayload = mockedEnqueuePasswordSetupMail.mock.calls
            .at(0)
            ?.at(0)
        const rawToken = mailPayload
            ? new URL(mailPayload.resetLink).searchParams.get('token')
            : null

        expect(storedUsers).toEqual([
            {
                id: result.user.id,
                username,
                email: normalizedEmail,
                createdByUserId: creatorUserId,
            },
        ])
        expect(storedProfiles).toEqual([{ userId: result.user.id }])
        expect(storedTokens).toHaveLength(1)
        expect(storedPermissionRows).toContainEqual({
            key: PERMISSIONS.USER_DASHBOARD,
        })
        expect(result.user.permissions).toContain(PERMISSIONS.USER_DASHBOARD)
        expect(rawToken).toBeTruthy()

        if (!rawToken) {
            throw new Error('Einladungs-Mail enthält kein Reset-Token.')
        }

        expect(storedTokens[0]?.tokenHash).toBe(await createTokenHash(rawToken))
        expect(storedTokens[0]?.tokenHash).not.toBe(rawToken)
        expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
    })

    it('entfernt die gesamte Benutzeranlage wieder, wenn das Queueing fehlschlägt', async function () {
        const suffix = crypto.randomUUID()
        const email = `${TEST_CREATED_EMAIL_PREFIX}${suffix}@example.com`
        mockedEnqueuePasswordSetupMail.mockRejectedValueOnce(
            new Error('isolierter Queue-Fehler'),
        )

        const result = await createUserService({
            username: `test-db-created-${suffix}`.slice(0, 50),
            email,
        })
        const storedUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))

        expect(result).toEqual({
            success: false,
            error: 'Einladungs-E-Mail konnte nicht eingeplant werden.',
        })
        expect(storedUsers).toEqual([])
        expect(mockedWriteAuditLog).toHaveBeenCalledTimes(2)
        expect(mockedWriteAuditLog.mock.calls[0]?.[1].action).toBe(
            'admin.user.created',
        )
        expect(mockedWriteAuditLog.mock.calls[1]?.[1].action).toBe(
            'admin.user.creation_rolled_back',
        )
    })
})
