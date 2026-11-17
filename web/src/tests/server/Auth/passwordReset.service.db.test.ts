import type { Mock } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, like } from 'drizzle-orm'
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
    passwordResetTokens,
    sessions,
    trustedDevices,
    users,
} from '@/db/schema.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { publishUserSessionsRevokedService } from '@/server/Realtime/publish.service.ts'
import { updatePasswordByTokenService } from '@/server/Auth/PasswordReset/update.service.ts'

const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])test(?:[_-]|$)/i
const TEST_RUN_ID = crypto.randomUUID()
const TEST_EMAIL_PREFIX = `test-db-password-reset+${TEST_RUN_ID}-`
const OLD_PASSWORD = 'Old-test-password-123!'
const NEW_PASSWORD = 'New-test-password-456!'
const execFileAsync = promisify(execFile)
const BUN_EXECUTABLE = process.env.npm_execpath ?? 'bun'

const serviceMocks = (function () {
    return {
        logError: vi.fn(function () {}),
        publishUserSessionsRevokedService: vi.fn(async function () {}),
        writeAuditLog: vi.fn(async function () {
            return { id: 'synthetic-audit-receipt', createdAt: new Date() }
        }),
    }
})()

vi.mock('@/server/Realtime/publish.service.ts', function () {
    return {
        publishUserSessionsRevokedService:
            serviceMocks.publishUserSessionsRevokedService,
    }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            return { actorUserId, route: null, method: 'POST' }
        },
        writeAuditLogInTransactionService: serviceMocks.writeAuditLog,
        async publishCommittedAuditLogService() {},
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: serviceMocks.logError }
})

const mockedPublishUserSessionsRevoked =
    publishUserSessionsRevokedService as Mock<
        typeof publishUserSessionsRevokedService
    >
const mockedWriteAuditLog = writeAuditLogInTransactionService as Mock<
    typeof writeAuditLogInTransactionService
>

async function createBunPasswordHash(password: string) {
    const { stdout } = await execFileAsync(BUN_EXECUTABLE, [
        '-e',
        'console.log(await Bun.password.hash(Bun.argv[1]))',
        password,
    ])

    return stdout.trim()
}

async function verifyBunPassword(password: string, passwordHash: string) {
    const { stdout } = await execFileAsync(BUN_EXECUTABLE, [
        '-e',
        'console.log(await Bun.password.verify(Bun.argv[1], Bun.argv[2]) ? "true" : "false")',
        password,
        passwordHash,
    ])

    return stdout.trim() === 'true'
}

function installBunPasswordBridge() {
    stubBunProperties({
        password: {
            hash: createBunPasswordHash,
            verify: verifyBunPassword,
        },
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

async function cleanupPasswordResetUsers() {
    await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`))
}

async function createPasswordResetFixture(expiresAt: Date) {
    const suffix = crypto.randomUUID()
    const rawToken = crypto.randomUUID()
    const tokenHash = await createTokenHash(rawToken)
    const passwordHash = await Bun.password.hash(OLD_PASSWORD)
    const insertedUsers = await db
        .insert(users)
        .values({
            accountType: 'public',
            username: `test-db-reset-${suffix}`.slice(0, 50),
            email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
            passwordHash,
            isActive: true,
        })
        .returning({ id: users.id })
    const userId = insertedUsers.at(0)?.id

    if (!userId) {
        throw new Error(
            'Passwort-Reset-Testbenutzer konnte nicht angelegt werden.',
        )
    }

    await db.insert(passwordResetTokens).values({
        userId,
        tokenHash,
        expiresAt,
    })
    await db.insert(sessions).values({
        id: await createTokenHash(`session-${suffix}`),
        userId,
        expiresAt: new Date(Date.now() + 60000),
    })
    await db.insert(trustedDevices).values({
        userId,
        deviceTokenHash: await createTokenHash(`device-${suffix}`),
        expiresAt: new Date(Date.now() + 60000),
    })

    return { passwordHash, rawToken, tokenHash, userId }
}

describe('updatePasswordByTokenService DB-Integration', function () {
    beforeAll(function () {
        requireIsolatedTestDatabaseUrl()
        installBunPasswordBridge()
    })

    beforeEach(function () {
        vi.clearAllMocks()
    })

    afterEach(async function () {
        await cleanupPasswordResetUsers()
    })

    afterAll(function () {
        restoreBunProperties()
    })

    it('verbraucht den Token genau einmal und widerruft Sessions sowie Trusted Devices', async function () {
        const fixture = await createPasswordResetFixture(
            new Date(Date.now() + 60000),
        )

        const result = await updatePasswordByTokenService({
            token: fixture.rawToken,
            password: NEW_PASSWORD,
        })
        const storedUsers = await db
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, fixture.userId))
        const storedTokens = await db
            .select({ id: passwordResetTokens.id })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, fixture.userId))
        const storedSessions = await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.userId, fixture.userId))
        const storedTrustedDevices = await db
            .select({ id: trustedDevices.id })
            .from(trustedDevices)
            .where(eq(trustedDevices.userId, fixture.userId))

        expect(result).toEqual({ success: true })
        expect(storedTokens).toEqual([])
        expect(storedSessions).toEqual([])
        expect(storedTrustedDevices).toEqual([])
        expect(
            await Bun.password.verify(
                NEW_PASSWORD,
                storedUsers[0]?.passwordHash ?? '',
            ),
        ).toBe(true)
        expect(mockedPublishUserSessionsRevoked).toHaveBeenCalledWith(
            expect.objectContaining({ userId: fixture.userId }),
        )
        expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)

        await expect(
            updatePasswordByTokenService({
                token: fixture.rawToken,
                password: 'Another-test-password-789!',
            }),
        ).resolves.toEqual({
            success: false,
            error: 'Ungültiger oder abgelaufener Token.',
        })
        expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1)
    })

    it('lässt bei einem abgelaufenen Token Passwort und Anmeldedaten unverändert', async function () {
        const fixture = await createPasswordResetFixture(
            new Date(Date.now() - 60000),
        )

        const result = await updatePasswordByTokenService({
            token: fixture.rawToken,
            password: NEW_PASSWORD,
        })
        const storedUsers = await db
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, fixture.userId))
        const storedTokens = await db
            .select({ tokenHash: passwordResetTokens.tokenHash })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, fixture.userId))
        const storedSessions = await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.userId, fixture.userId))
        const storedTrustedDevices = await db
            .select({ id: trustedDevices.id })
            .from(trustedDevices)
            .where(eq(trustedDevices.userId, fixture.userId))

        expect(result).toEqual({
            success: false,
            error: 'Ungültiger oder abgelaufener Token.',
        })
        expect(storedUsers[0]?.passwordHash).toBe(fixture.passwordHash)
        expect(storedTokens).toEqual([{ tokenHash: fixture.tokenHash }])
        expect(storedSessions).toHaveLength(1)
        expect(storedTrustedDevices).toHaveLength(1)
        expect(mockedPublishUserSessionsRevoked).not.toHaveBeenCalled()
        expect(mockedWriteAuditLog).not.toHaveBeenCalled()
    })
})
