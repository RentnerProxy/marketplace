import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    DEFAULT_ADMIN_PERMISSION_KEYS,
    DEFAULT_PERMISSIONS,
    PERMISSIONS,
    PUBLIC_PERMISSION_KEYS,
} from '@/config/permissions.config.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from '@/server/Auth/authorization.errors.ts'
import type { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { requireMarketplaceAccountAccessService } from '@/server/Marketplace/account-access.service.ts'

type SessionUser = NonNullable<
    Awaited<ReturnType<typeof getActiveCurrentSessionUser>>
>

const access = {
    session: vi.fn<() => Promise<SessionUser | null>>(),
    permissions: vi.fn<() => Promise<Array<string>>>(),
    maintenance: vi.fn(),
}
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getActiveCurrentSessionUser: access.session,
}))
vi.mock('@/lib/Permissions/userPermissions.ts', () => ({
    getUserPermissionKeys: access.permissions,
}))
vi.mock('@/server/Maintenance/state.service.ts', () => ({
    getMaintenanceStateService: access.maintenance,
}))

function publicSession(overrides: Partial<SessionUser> = {}): SessionUser {
    return {
        id: 'public-actor',
        username: 'private-account-name',
        email: 'private@example.test',
        sessionHash: 'synthetic-session-hash',
        accountType: 'public',
        emailVerifiedAt: new Date('2026-11-01T10:00:00.000Z'),
        isActive: true,
        isDeleted: false,
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
    }
}

const contributorActions = ['submit', 'rate'] as const
const staffActions = [
    ['review', PERMISSIONS.ADMIN_MARKETPLACE_REVIEW, 'assignNamespace'],
    ['assignNamespace', PERMISSIONS.ADMIN_MARKETPLACE_NAMESPACE, 'review'],
] as const

beforeEach(() => {
    access.session.mockReset().mockResolvedValue(null)
    access.permissions.mockReset().mockResolvedValue([])
    access.maintenance.mockReset().mockResolvedValue({ isActive: false })
})

describe('Marketplace account authorization', () => {
    it.each(contributorActions)('requires login to %s', async (action) => {
        await expect(
            requireMarketplaceAccountAccessService(action),
        ).rejects.toBeInstanceOf(AuthenticationRequiredError)
        expect(access.permissions).not.toHaveBeenCalled()
    })

    it.each(contributorActions)(
        'scopes %s to the verified public actor',
        async (action) => {
            access.session.mockResolvedValue(publicSession())
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).resolves.toEqual({ userId: 'public-actor' })
        },
    )

    it.each(contributorActions)(
        'blocks %s until the current email address is verified',
        async (action) => {
            access.session.mockResolvedValue(
                publicSession({ emailVerifiedAt: null }),
            )
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
        },
    )

    it.each(contributorActions)(
        'keeps %s on the public account even when a staff session is verified',
        async (action) => {
            access.session.mockResolvedValue(
                publicSession({ accountType: 'staff' }),
            )
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
        },
    )

    it.each(staffActions)(
        'requires a staff account and the explicit right to %s',
        async (action, permission, otherAction) => {
            access.session.mockResolvedValue(publicSession())
            access.permissions.mockResolvedValue([permission])
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).rejects.toBeInstanceOf(PermissionDeniedError)

            access.session.mockResolvedValue(
                publicSession({
                    id: 'staff-actor',
                    accountType: 'staff',
                    emailVerifiedAt: null,
                }),
            )
            access.permissions.mockResolvedValue([
                PERMISSIONS.ADMIN_DASHBOARD,
                PERMISSIONS.ADMIN_SUPER_USER,
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
            ])
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).rejects.toBeInstanceOf(PermissionDeniedError)

            access.permissions.mockResolvedValue([permission])
            await expect(
                requireMarketplaceAccountAccessService(action),
            ).resolves.toEqual({ userId: 'staff-actor' })
            await expect(
                requireMarketplaceAccountAccessService(otherAction),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
        },
    )

    it.each(staffActions)(
        'makes the %s permission separately assignable to staff',
        (_action, permission) => {
            expect(DEFAULT_PERMISSIONS.map(({ key }) => key)).toContain(
                permission,
            )
            expect(DEFAULT_ADMIN_PERMISSION_KEYS).not.toContain(permission)
            expect(PUBLIC_PERMISSION_KEYS).not.toContain(permission)
        },
    )

    it('blocks a verified actor during maintenance', async () => {
        access.session.mockResolvedValue(publicSession())
        access.maintenance.mockResolvedValue({ isActive: true })
        await expect(
            requireMarketplaceAccountAccessService('submit'),
        ).rejects.toBeInstanceOf(MaintenanceModeError)
    })

    it('rejects sessions that expire during authorization', async () => {
        const session = publicSession()
        access.session.mockResolvedValue(session)
        access.maintenance.mockImplementation(async () => {
            session.expiresAt = new Date(0)
            return { isActive: false }
        })
        await expect(
            requireMarketplaceAccountAccessService('rate'),
        ).rejects.toBeInstanceOf(AuthenticationRequiredError)
    })
})
