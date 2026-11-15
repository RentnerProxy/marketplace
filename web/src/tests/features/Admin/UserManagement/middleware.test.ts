import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    authorize,
    createServerFnStub,
} from './management-middleware.test.helpers.ts'
import type { Boundary } from './management-middleware.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'

const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const active = vi.fn()
const resetPassword = vi.fn()
const users = vi.fn()
const permissions = vi.fn()
const rateLimit = vi.fn()
vi.mock('@tanstack/react-start', () => ({ createServerFn: createServerFnStub }))
vi.mock('@/server/Admin/UserManagement/create.service.ts', () => ({
    createUserService: create,
}))
vi.mock('@/server/Admin/UserManagement/update.service.ts', () => ({
    updateUserProfileService: update,
}))
vi.mock('@/server/Admin/UserManagement/delete.service.ts', () => ({
    deleteUserService: remove,
}))
vi.mock('@/server/Admin/UserManagement/active.service.ts', () => ({
    setUserActiveService: active,
}))
vi.mock('@/server/Admin/UserManagement/password.service.ts', () => ({
    resetUserPasswordService: resetPassword,
}))
vi.mock('@/server/Admin/UserManagement/get.service.ts', () => ({
    getUsersService: users,
    getPermissionsService: permissions,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))
const handlers = await import('@/features/Admin/UserManagement/middleware.ts')

const id = '01941f29-7c00-7000-8000-000000000001'
const cases = [
    ['getPermissionsHandler', permissions, undefined],
    ['getUsersHandler', users, undefined],
    [
        'createUserHandler',
        create,
        { username: 'member', email: 'member@example.invalid' },
    ],
    [
        'updateUserProfileHandler',
        update,
        {
            id,
            username: 'member',
            email: 'member@example.invalid',
            firstName: '',
            lastName: '',
            street: '',
            houseNumber: '',
            postalCode: '',
            city: '',
        },
    ],
    ['deleteUserHandler', remove, { id }],
    ['setUserActiveHandler', active, { id, isActive: false }],
    ['resetUserPasswordHandler', resetPassword, { id }],
] as const

beforeEach(() => {
    vi.clearAllMocks()
    authorize.mockReset().mockResolvedValue({ userId: 'actor' })
    rateLimit.mockReset().mockResolvedValue(undefined)
    for (const [, service] of cases)
        service.mockReset().mockResolvedValue({ success: true })
})

describe('user management server boundaries', () => {
    it.each(cases)(
        'authorizes %s before delegating to its service',
        async (name, service, data) => {
            const handler = handlers[name] as unknown as Boundary
            const response = await handler(data ? { data } : undefined)
            expect(authorize).toHaveBeenCalledWith(
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            )
            expect(service).toHaveBeenCalledTimes(1)
            if (data) expect(service).toHaveBeenCalledWith(data)
            else expect(service).toHaveBeenCalledWith()
            expect(response).toEqual({ success: true })
        },
    )

    it.each(cases)(
        'blocks %s when authorization rejects',
        async (name, service, data) => {
            authorize.mockRejectedValue(new Error('Forbidden'))
            const handler = handlers[name] as unknown as Boundary
            await expect(handler(data ? { data } : undefined)).rejects.toThrow(
                'Forbidden',
            )
            expect(service).not.toHaveBeenCalled()
            expect(rateLimit).not.toHaveBeenCalled()
        },
    )

    it.each(cases.filter(([, , data]) => Boolean(data)))(
        'rejects invalid input for %s before invoking services',
        async (name, service) => {
            const handler = handlers[name] as unknown as Boundary
            await expect(handler({ data: {} })).rejects.toThrow()
            expect(authorize).not.toHaveBeenCalled()
            expect(service).not.toHaveBeenCalled()
        },
    )

    it('normalizes create input before passing it to the domain service', async () => {
        await (handlers.createUserHandler as unknown as Boundary)({
            data: { username: ' member ', email: ' member@example.invalid ' },
        })
        expect(create).toHaveBeenCalledWith({
            username: 'member',
            email: 'member@example.invalid',
        })
    })

    it('limits password resets by actor/IP and target before sending an invitation', async () => {
        await (handlers.resetUserPasswordHandler as unknown as Boundary)({
            data: { id },
        })
        expect(rateLimit).toHaveBeenNthCalledWith(1, {
            ...RATE_LIMITS.adminPasswordResetIp,
            scope: 'admin-user-password-reset-ip',
            identifiers: ['actor'],
        })
        expect(rateLimit).toHaveBeenNthCalledWith(2, {
            ...RATE_LIMITS.adminPasswordResetTarget,
            scope: 'admin-user-password-reset-target',
            identifiers: ['actor', id],
            includeClientIp: false,
        })
        expect(resetPassword).toHaveBeenCalledWith({ id })
    })

    it.each([1, 2])(
        'does not send a password reset if rate limiter %s rejects',
        async (blockedCall) => {
            let calls = 0
            rateLimit.mockImplementation(async () => {
                if (++calls === blockedCall) throw new Error('Rate limited')
            })
            await expect(
                (handlers.resetUserPasswordHandler as unknown as Boundary)({
                    data: { id },
                }),
            ).rejects.toThrow('Rate limited')
            expect(resetPassword).not.toHaveBeenCalled()
            expect(rateLimit).toHaveBeenCalledTimes(blockedCall)
        },
    )
})
