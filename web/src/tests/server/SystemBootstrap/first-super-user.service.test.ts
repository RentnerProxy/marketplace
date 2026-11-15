import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createFirstSuperUserAccountService } from '@/server/SystemBootstrap/first-super-user.service.ts'
import { DEFAULT_ADMIN_PERMISSION_KEYS } from '@/config/permissions.config.ts'
import {
    authAuditDb,
    authAuditMocks,
    authAuditOrm,
    authAuditSchema,
    authAuditState,
    createAuthAuditTestApi,
    resetAuthAuditTestState,
} from '../Auth/audit-transaction.test.helpers.ts'

const validAccess = vi.fn(async function (_token: string) {
    return true
})
const clearAccess = vi.fn(async function () {
    authAuditState.events.push('access:clear')
})
const logError = vi.fn()
vi.mock('drizzle-orm', () => authAuditOrm)
vi.mock('@/db', () => ({ db: authAuditDb }))
vi.mock('@/db/schema.ts', () => authAuditSchema)
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => authAuditMocks)
vi.mock('@/server/Logging/logger.ts', () => ({ logError }))
vi.mock('@/server/SystemBootstrap/permissions.service.ts', () => ({
    async syncDefaultPermissions(
        transaction: ReturnType<typeof createAuthAuditTestApi>,
    ) {
        const permissions = DEFAULT_ADMIN_PERMISSION_KEYS.map((key, index) => ({
            id: 'permission-' + String(index),
            key,
        }))
        await transaction
            .insert(authAuditSchema.permissions)
            .values(permissions)
        return { permissions }
    },
}))
vi.mock(
    '@/server/SystemBootstrap/first-super-user-setup-access.service.ts',
    () => ({
        clearFirstSuperUserSetupAccessService: clearAccess,
        hasValidFirstSuperUserSetupAccessService: validAccess,
    }),
)
const input = {
    username: 'admin',
    email: 'admin@example.test',
    password: 'password',
    confirmPassword: 'password',
    setupToken: 'synthetic-setup-access',
    firstName: '',
    lastName: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
}

beforeEach(function () {
    vi.clearAllMocks()
    resetAuthAuditTestState()
    vi.spyOn(Bun.password, 'hash').mockResolvedValue('synthetic-password-hash')
})
afterEach(function () {
    vi.restoreAllMocks()
})

describe('Erster Superuser Setup-Token und Pflichtaudit', function () {
    it('blockiert vor jedem Datenbankzugriff ohne gültigen Setup-Link', async function () {
        validAccess.mockResolvedValueOnce(false)
        await expect(
            createFirstSuperUserAccountService(input),
        ).resolves.toEqual({ success: false, errorCode: 'invalid_setup_token' })
        expect(authAuditDb.transaction).not.toHaveBeenCalled()
        expect(clearAccess).not.toHaveBeenCalled()
    })
    it('schlägt bei nicht verfügbarem Zugriffsspeicher geschlossen fehl', async function () {
        validAccess.mockRejectedValueOnce(new Error('Valkey nicht verfügbar'))
        await expect(createFirstSuperUserAccountService(input)).rejects.toThrow(
            'Valkey nicht verfügbar',
        )
        expect(authAuditDb.transaction).not.toHaveBeenCalled()
    })
    it('does not mutate or audit an installation completed under the bootstrap lock', async function () {
        authAuditState.rows.users = [{ id: 'existing-user' }]
        const before = structuredClone(authAuditState.rows)
        expect(await createFirstSuperUserAccountService(input)).toEqual({
            success: false,
            errorCode: 'setup_already_completed',
        })
        expect(authAuditState.rows).toEqual(before)
        expect(clearAccess).not.toHaveBeenCalled()
        expect(
            authAuditMocks.writeAuditLogInTransactionService,
        ).not.toHaveBeenCalled()
    })
    it('commits the new account, profile, permissions, settings and self-attributed audit before access cleanup', async function () {
        const result = await createFirstSuperUserAccountService(input)
        expect(result).toEqual({
            success: true,
            user: {
                id: 'new-users-1',
                username: input.username,
                email: input.email,
            },
        })
        expect(authAuditState.rows.users).toHaveLength(1)
        expect(authAuditState.rows.user_profiles).toHaveLength(1)
        expect(authAuditState.rows.systemSettings).toHaveLength(1)
        expect(authAuditState.rows.permissions.length).toBeGreaterThan(0)
        expect(authAuditState.rows.userPermissions.length).toBeGreaterThan(0)
        expect(authAuditState.rows.auditLogs).toEqual([
            expect.objectContaining({
                action: 'system.first-super-user.created',
                actorUserId: 'new-users-1',
            }),
        ])
        const events = authAuditState.events
        expect(events.indexOf('context')).toBeLessThan(
            events.indexOf('tx:begin'),
        )
        expect(events.indexOf('audit:tx')).toBeLessThan(
            events.indexOf('tx:commit'),
        )
        expect(events.indexOf('tx:commit')).toBeLessThan(
            events.indexOf('access:clear'),
        )
        expect(JSON.stringify(result)).not.toContain('audit-')
        expect(JSON.stringify(authAuditState.rows.auditLogs)).not.toContain(
            input.setupToken,
        )
        expect(JSON.stringify(authAuditState.rows.auditLogs)).not.toContain(
            'synthetic-password-hash',
        )
    })
    it.each(['audit', 'commit'])(
        'rolls back all initial data when %s fails and preserves the setup access',
        async function (failure) {
            const before = structuredClone(authAuditState.rows)
            if (failure === 'audit') authAuditState.failAuditAt = 1
            else authAuditState.failCommitAt = 1
            await expect(
                createFirstSuperUserAccountService(input),
            ).rejects.toThrow('Synthetic ' + failure + ' failure')
            expect(authAuditState.rows).toEqual(before)
            expect(authAuditState.events.at(-1)).toBe('tx:rollback')
            expect(clearAccess).not.toHaveBeenCalled()
            expect(
                authAuditMocks.publishCommittedAuditLogService,
            ).not.toHaveBeenCalled()
        },
    )
    it('retains the account and audit when post-commit setup-access cleanup fails', async function () {
        clearAccess.mockRejectedValueOnce(
            new Error('Synthetic access cleanup failure'),
        )
        expect(await createFirstSuperUserAccountService(input)).toMatchObject({
            success: true,
        })
        expect(authAuditState.rows.users).toHaveLength(1)
        expect(authAuditState.rows.auditLogs).toHaveLength(1)
        expect(logError).toHaveBeenCalledTimes(1)
    })
})
