import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import {
    authorize,
    createServerFnStub,
} from '../UserManagement/management-middleware.test.helpers.ts'
import type { Boundary } from '../UserManagement/management-middleware.test.helpers.ts'

const send = vi.fn()
const revoke = vi.fn()
const list = vi.fn()
const accept = vi.fn()
const rateLimit = vi.fn()

vi.mock('@tanstack/react-start', () => ({ createServerFn: createServerFnStub }))
vi.mock('@/server/Admin/StaffManagement/invitations.service.ts', () => ({
    getStaffInvitationsService: list,
    inviteStaffService: send,
    revokeStaffInvitationService: revoke,
}))
vi.mock('@/server/Auth/StaffInvitation/accept.service.ts', () => ({
    acceptStaffInvitationService: accept,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError: vi.fn() }))

const {
    getStaffInvitationsHandler,
    inviteStaffHandler,
    revokeStaffInvitationHandler,
} = await import('@/features/Admin/StaffManagement/middleware.ts')
const { acceptStaffInvitationHandler } =
    await import('@/features/Auth/StaffInvitation/middleware.ts')

const id = '01941f29-7c00-7000-8000-000000000001'
const input = {
    email: ' Staff@Example.test ',
    username: ' staff ',
    permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
}
const acceptance = { token: 'i'.repeat(43), password: 'synthetic-password' }

beforeEach(() => {
    vi.clearAllMocks()
    authorize.mockReset().mockResolvedValue({ userId: id })
    rateLimit.mockReset().mockResolvedValue(undefined)
    accept.mockResolvedValue({ success: true })
})

describe('staff invitation server boundaries', () => {
    it('requires superuser permission for listing, sending, and revocation', async () => {
        await getStaffInvitationsHandler()
        await inviteStaffHandler({ data: input })
        await revokeStaffInvitationHandler({ data: { id } })

        expect(authorize.mock.calls).toEqual(
            Array.from({ length: 3 }, () => [PERMISSIONS.ADMIN_SUPER_USER]),
        )
        expect(list).toHaveBeenCalledWith(id)
        expect(send).toHaveBeenCalledWith(
            {
                ...input,
                email: 'staff@example.test',
                username: 'staff',
            },
            id,
        )
        expect(revoke).toHaveBeenCalledWith(id, id)
        expect(rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.staffInvitationSend,
            scope: 'staff-invitation-send',
            identifiers: [id],
            includeClientIp: false,
        })
    })

    it('rejects automatic superuser rights before sending invitations', async () => {
        const sendHandler = inviteStaffHandler as unknown as Boundary
        await expect(
            sendHandler({
                data: {
                    ...input,
                    permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                },
            }),
        ).rejects.toThrow()
        expect(authorize).not.toHaveBeenCalled()
        expect(send).not.toHaveBeenCalled()
    })

    it('rate-limits unauthenticated acceptance before consuming the token', async () => {
        await expect(
            acceptStaffInvitationHandler({ data: acceptance }),
        ).resolves.toEqual({ success: true })
        expect(rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.staffInvitationAccept,
            scope: 'staff-invitation-accept',
        })
        expect(accept).toHaveBeenCalledWith(acceptance)
        rateLimit.mockRejectedValueOnce(new Error('rate limit'))
        await expect(
            acceptStaffInvitationHandler({ data: acceptance }),
        ).resolves.toEqual({ success: false, unavailable: true })
        expect(accept).toHaveBeenCalledTimes(1)
    })
})
