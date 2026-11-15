import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import {
    createTransactionAuthorizationHarness,
    transactionAuthorizationSchema,
} from './transaction-authorization.test.helpers.ts'

const globalRead = vi.fn(function () {
    throw new Error('A mutation policy must read its transaction')
})
vi.mock('@/db', () => ({ db: { select: globalRead } }))
vi.mock('@/db/schema.ts', () => transactionAuthorizationSchema)
vi.mock('drizzle-orm', () => ({
    eq: (column: unknown, value: unknown) => ({ column, value }),
}))

beforeEach(function () {
    vi.clearAllMocks()
})

describe('current mutation permission under the actor lock', function () {
    it.each([PERMISSIONS.ADMIN_BACKUPS, PERMISSIONS.ADMIN_SYSTEM_SETTINGS])(
        'accepts only the current exact %s permission from its transaction',
        async function (permission) {
            const { state, transaction } =
                createTransactionAuthorizationHarness()
            state.permissionKeys = [permission]
            await expect(
                requireMutationPermissionService(
                    transaction as never,
                    state.userId,
                    permission,
                ),
            ).resolves.toBeUndefined()
            expect(state.events).toEqual([
                'lock:requested',
                'lock:acquired',
                'active-read',
                'permission-read',
            ])
            expect(globalRead).not.toHaveBeenCalled()
        },
    )

    it.each([
        'no permission',
        'superuser only',
        'another admin permission',
        'case mismatch',
        'missing user',
        'inactive user',
        'deleted user',
    ])(
        'denies %s even when a caller has already passed an earlier guard',
        async function (condition) {
            const { state, transaction } =
                createTransactionAuthorizationHarness()
            if (condition === 'no permission') state.permissionKeys = []
            if (condition === 'superuser only')
                state.permissionKeys = [PERMISSIONS.ADMIN_SUPER_USER]
            if (condition === 'another admin permission')
                state.permissionKeys = [PERMISSIONS.ADMIN_SYSTEM_SETTINGS]
            if (condition === 'case mismatch')
                state.permissionKeys = [PERMISSIONS.ADMIN_BACKUPS.toUpperCase()]
            if (condition === 'missing user') state.present = false
            if (condition === 'inactive user') state.isActive = false
            if (condition === 'deleted user') state.isDeleted = true
            await expect(
                requireMutationPermissionService(
                    transaction as never,
                    state.userId,
                    PERMISSIONS.ADMIN_BACKUPS,
                ),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(state.events.slice(0, 3)).toEqual([
                'lock:requested',
                'lock:acquired',
                'active-read',
            ])
            expect(globalRead).not.toHaveBeenCalled()
        },
    )

    it.each(['permission revoked', 'deactivated', 'deleted'])(
        'reads the committed state after waiting for a competing actor lock: %s',
        async function (condition) {
            const { state, transaction } =
                createTransactionAuthorizationHarness()
            const requested = Promise.withResolvers<void>()
            const released = Promise.withResolvers<void>()
            state.beforeLock = function () {
                requested.resolve()
                return released.promise
            }
            const checking = requireMutationPermissionService(
                transaction as never,
                state.userId,
                PERMISSIONS.ADMIN_BACKUPS,
            )
            await requested.promise
            expect(state.events).toEqual(['lock:requested'])
            if (condition === 'permission revoked') state.permissionKeys = []
            if (condition === 'deactivated') state.isActive = false
            if (condition === 'deleted') state.isDeleted = true
            released.resolve()
            await expect(checking).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(state.events.indexOf('active-read')).toBeGreaterThan(
                state.events.indexOf('lock:acquired'),
            )
            expect(globalRead).not.toHaveBeenCalled()
        },
    )

    it('accepts a grant completed before acquiring the actor lock', async function () {
        const { state, transaction } = createTransactionAuthorizationHarness()
        state.permissionKeys = []
        const requested = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        state.beforeLock = function () {
            requested.resolve()
            return released.promise
        }
        const checking = requireMutationPermissionService(
            transaction as never,
            state.userId,
            PERMISSIONS.ADMIN_BACKUPS,
        )
        await requested.promise
        expect(state.events).toEqual(['lock:requested'])
        state.permissionKeys = [PERMISSIONS.ADMIN_BACKUPS]
        released.resolve()
        await expect(checking).resolves.toBeUndefined()
        expect(state.events).toEqual([
            'lock:requested',
            'lock:acquired',
            'active-read',
            'permission-read',
        ])
        expect(globalRead).not.toHaveBeenCalled()
    })

    it('does not check or authorize through an unsuccessful lock', async function () {
        const { state, transaction } = createTransactionAuthorizationHarness()
        const failure = new Error('Synthetic lock failure')
        state.beforeLock = async function () {
            throw failure
        }
        await expect(
            requireMutationPermissionService(
                transaction as never,
                state.userId,
                PERMISSIONS.ADMIN_BACKUPS,
            ),
        ).rejects.toBe(failure)
        expect(state.events).toEqual(['lock:requested'])
        expect(globalRead).not.toHaveBeenCalled()
    })

    it('cannot use another actor row or permission owner', async function () {
        const { state, transaction } = createTransactionAuthorizationHarness()
        await expect(
            requireMutationPermissionService(
                transaction as never,
                '00000000-0000-4000-8000-000000000003',
                PERMISSIONS.ADMIN_BACKUPS,
            ),
        ).rejects.toBeInstanceOf(PermissionDeniedError)
        expect(state.events).toEqual([
            'lock:requested',
            'lock:acquired',
            'active-read',
        ])
        expect(globalRead).not.toHaveBeenCalled()
    })
})
