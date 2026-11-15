import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const redirect = vi.fn((options: { to: string }) => ({
    isRedirect: true,
    ...options,
}))
vi.mock('@tanstack/react-router', () => ({ redirect }))
import {
    getLoginRedirectReason,
    redirectPublicRouteForSetupStatus,
    redirectSetupRouteForSetupStatus,
    redirectWhenMissingConfiguredPermission,
} from '@/lib/Routes/routeRedirects.ts'

beforeEach(() => vi.clearAllMocks())

describe('public and protected redirect decisions', function () {
    it('routes incomplete installations to setup but retains the setup page', function () {
        expect(() => redirectPublicRouteForSetupStatus(true, '/login')).toThrow(
            expect.objectContaining({ to: '/setup' }),
        )
        expect(() =>
            redirectPublicRouteForSetupStatus(true, '/setup'),
        ).not.toThrow()
        expect(() =>
            redirectSetupRouteForSetupStatus(true, '/setup'),
        ).not.toThrow()
    })

    it('returns completed installations to login only when entering setup', function () {
        expect(() =>
            redirectPublicRouteForSetupStatus(false, '/setup'),
        ).toThrow(expect.objectContaining({ to: '/login' }))
        expect(() => redirectSetupRouteForSetupStatus(false, '/setup')).toThrow(
            expect.objectContaining({ to: '/login' }),
        )
        expect(() =>
            redirectPublicRouteForSetupStatus(false, '/login'),
        ).not.toThrow()
        expect(() =>
            redirectSetupRouteForSetupStatus(false, '/login'),
        ).not.toThrow()
    })

    it.each([
        'password-reset-token-missing',
        'password-reset-token-invalid',
    ] as const)(
        'recognizes the supported recovery notice %s with or without a fragment marker',
        function (reason) {
            expect(getLoginRedirectReason(reason)).toBe(reason)
            expect(getLoginRedirectReason(`#${reason}`)).toBe(reason)
            expect(
                getLoginRedirectReason('#' + reason + '-extra'),
            ).toBeUndefined()
        },
    )

    it('ignores unknown notices and allows authorized or unmapped routes', function () {
        expect(getLoginRedirectReason('')).toBeUndefined()
        expect(getLoginRedirectReason('#arbitrary')).toBeUndefined()
        expect(() =>
            redirectWhenMissingConfiguredPermission('/admin/users', [
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ]),
        ).not.toThrow()
        expect(() =>
            redirectWhenMissingConfiguredPermission('/unmapped'),
        ).not.toThrow()
        expect(redirect).not.toHaveBeenCalled()
    })
})
