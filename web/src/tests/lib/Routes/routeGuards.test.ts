import type { Mock } from 'bun:test'
import { redirect } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { validateSessionHandler } from '@/features/Auth/middleware.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { redirectWhenMissingConfiguredPermission } from '@/lib/Routes/routeRedirects.ts'
import {
    requireAuthenticatedRoute,
    requireConfiguredPermissionRouteFromQueryClient,
} from '@/lib/Routes/routeGuards.ts'

vi.mock('@tanstack/react-router', function () {
    return {
        redirect: vi.fn(function (options: unknown) {
            return {
                isRedirect: true,
                ...(options as Record<string, unknown>),
            }
        }),
    }
})

vi.mock('@/features/Auth/middleware.ts', function () {
    return {
        validateSessionHandler: vi.fn(),
    }
})

const mockedValidateSession = validateSessionHandler as unknown as Mock<
    typeof validateSessionHandler
>

function createSessionUser(id: string) {
    return {
        id,
        username: 'test-user',
        email: 'test@example.com',
        isTwoFactorEnabled: false,
        isActive: true,
        isDeleted: false,
        createdAt: new Date(),
        accountType: 'public' as const,
        firstName: null,
        lastName: null,
        street: null,
        houseNumber: null,
        postalCode: null,
        city: null,
        primaryColor: null,
        themeMode: null,
        fontFamily: null,
        fontSize: null,
        customBackgroundUpdatedAt: null,
        customBackgroundDarkness: null,
        profileImageVersion: null,
    }
}

describe('Route-Guards', function () {
    beforeEach(function () {
        vi.clearAllMocks()
    })

    it('leitet anonyme Benutzer zum Login weiter', async function () {
        mockedValidateSession.mockResolvedValueOnce({
            user: null,
            maintenance: {
                isActive: false,
                isScheduled: false,
                startsAt: null,
            },
        })

        await expect(requireAuthenticatedRoute()).rejects.toMatchObject({
            isRedirect: true,
            to: '/login',
        })
    })

    it('leitet während aktiver Wartung auf die Wartungsseite weiter', async function () {
        mockedValidateSession.mockResolvedValueOnce({
            user: createSessionUser('user-1'),
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            absoluteExpiresAt: new Date(
                Date.now() + 8 * 60 * 60_000,
            ).toISOString(),
            permissions: [PERMISSIONS.USER_DASHBOARD],
            maintenance: {
                isActive: true,
                isScheduled: false,
                startsAt: new Date().toISOString(),
            },
            canBypassMaintenance: false,
        })

        await expect(
            requireAuthenticatedRoute('/user/dashboard'),
        ).rejects.toMatchObject({
            isRedirect: true,
            to: '/maintenance',
            search: { redirect: '/user/dashboard' },
        })
    })

    it('verwendet eine vorhandene Session aus dem Query-Cache', async function () {
        const queryClient = {
            getQueryData: vi.fn(function () {
                return {
                    user: createSessionUser('admin-1'),
                    permissions: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                }
            }),
        }

        await expect(
            requireConfiguredPermissionRouteFromQueryClient(
                queryClient as never,
                '/admin/users',
            ),
        ).resolves.toBeUndefined()
        expect(mockedValidateSession).not.toHaveBeenCalled()
    })

    it('leitet bei fehlender Route-Permission auf die Default-Route weiter', function () {
        expect(function () {
            redirectWhenMissingConfiguredPermission('/admin/users', [
                PERMISSIONS.USER_DASHBOARD,
            ])
        }).toThrow(
            expect.objectContaining({
                isRedirect: true,
                to: '/user/dashboard',
            }),
        )
    })

    it('ignoriert Routen ohne konfigurierte Permission', function () {
        expect(function () {
            redirectWhenMissingConfiguredPermission('/freie-route', [])
        }).not.toThrow()
        expect(redirect).not.toHaveBeenCalled()
    })
})
