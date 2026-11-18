import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import {
    ADMIN_ACTOR_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from '../UserManagement/admin-audit.test.helpers.ts'

installAdminAuditTestMocks()
const { getStaffInvitationsService, inviteStaffService } =
    await import('@/server/Admin/StaffManagement/invitations.service.ts')
const { manageStaffInvitationService } =
    await import('@/server/Admin/StaffManagement/manageInvitation.service.ts')
const { prepareStaffInvitationResendMailService } =
    await import('@/server/Admin/StaffManagement/resendInvitation.service.ts')
const { acceptStaffInvitationService } =
    await import('@/server/Auth/StaffInvitation/accept.service.ts')

const input = {
    username: 'colleague',
    email: 'colleague@example.test',
    permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
}
const password = 'synthetic-staff-password'

async function sendInvitation() {
    expect(await inviteStaffService(input, ADMIN_ACTOR_ID)).toEqual({
        success: true,
    })
    return lastInvitationToken()
}

function lastInvitationToken() {
    const payload = adminAuditExternal.enqueueInvitation.mock.lastCall?.[0]
    if (!payload) throw new Error('Expected a queued invitation')
    return invitationToken(payload.resetLink)
}

function invitationToken(resetLink: string) {
    const token = new URLSearchParams(new URL(resetLink).hash.slice(1)).get(
        'invite',
    )
    if (!token) throw new Error('Expected a fragment-only invitation token')
    return token
}

beforeEach(() => {
    vi.clearAllMocks()
    adminAuditDb.reset()
    adminAuditExternal.enqueueInvitation.mockResolvedValue(undefined)
    adminAuditExternal.enqueueInvitationResend.mockResolvedValue(undefined)
})

describe('staff invitation lifecycle', () => {
    it('publishes a safe pending invitation and accepts it with only the selected staff grants', async () => {
        const token = await sendInvitation()
        const invitations = await getStaffInvitationsService(ADMIN_ACTOR_ID)
        expect(invitations).toHaveLength(1)
        expect(invitations[0]).toEqual({
            id: expect.any(String),
            username: input.username,
            email: input.email,
            expiresAt: expect.any(String),
            status: 'active',
            permissionKeys: input.permissionKeys,
        })
        expect(adminAuditDb.state.rows.staffInvitations[0].tokenHash).toBe(
            await createTokenHash(token),
        )
        expect(JSON.stringify(adminAuditDb.state.rows.auditLogs)).not.toContain(
            token,
        )
        expect(await acceptStaffInvitationService({ token, password })).toEqual(
            { success: true },
        )
        const user = adminAuditDb.state.rows.users.find(
            ({ email }) => email === input.email,
        )
        expect(user?.accountType).toBe('staff')
        expect(adminAuditDb.state.rows.staffAccounts).toContainEqual(
            expect.objectContaining({
                userId: user?.id,
                invitedByUserId: ADMIN_ACTOR_ID,
            }),
        )
        const grants = adminAuditDb.state.rows.staffUserPermissions.filter(
            ({ userId }) => userId === user?.id,
        )
        expect(grants).toEqual([
            expect.objectContaining({
                permissionId: 'permission:' + PERMISSIONS.ADMIN_DASHBOARD,
            }),
        ])
        expect(adminAuditDb.state.rows.publicUserPermissions).toEqual([])
        expect(await acceptStaffInvitationService({ token, password })).toEqual(
            { success: false },
        )
        expect(await getStaffInvitationsService(ADMIN_ACTOR_ID)).toEqual([])
    })

    it('requires an active superuser for creation, reads, and acceptance', async () => {
        const token = await sendInvitation()
        adminAuditDb.state.rows.users[1].isActive = false
        await expect(
            getStaffInvitationsService(ADMIN_ACTOR_ID),
        ).rejects.toThrow()
        await expect(
            inviteStaffService(input, ADMIN_ACTOR_ID),
        ).rejects.toThrow()
        expect(await acceptStaffInvitationService({ token, password })).toEqual(
            { success: false },
        )
        expect(adminAuditDb.state.rows.users).toHaveLength(2)
        expect(adminAuditDb.state.rows.staffInvitations).toMatchObject([
            { isActive: false },
        ])
        expect(adminAuditDb.state.rows.auditLogs.at(-1)?.action).toBe(
            'auth.staff_invitation_deactivated',
        )
    })

    it('rejects account collisions and invalid initial permissions without queuing mail', async () => {
        await expect(
            inviteStaffService(
                { ...input, username: 'TARGET' },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: false, error: 'identityInUse' })
        for (const permissionKeys of [[], [PERMISSIONS.ADMIN_SUPER_USER]]) {
            // Each invitation runs in its own transaction to exercise the authoritative policy.
            // oxlint-disable-next-line no-await-in-loop
            await expect(
                inviteStaffService(
                    { ...input, permissionKeys },
                    ADMIN_ACTOR_ID,
                ),
            ).resolves.toEqual({ success: false, error: 'invalidPermissions' })
        }
        expect(adminAuditExternal.enqueueInvitation).not.toHaveBeenCalled()
    })

    it('rolls back the reservation when the mandatory invitation audit fails', async () => {
        adminAuditDb.state.failAuditAction = 'admin.staff.invitation_created'
        await expect(inviteStaffService(input, ADMIN_ACTOR_ID)).rejects.toThrow(
            'Injected persistence failure',
        )
        expect(adminAuditDb.state.rows.staffInvitations).toEqual([])
        expect(adminAuditExternal.enqueueInvitation).not.toHaveBeenCalled()
    })

    it('cleans up the exact invite on delivery failure and allows a later invitation to be revoked', async () => {
        adminAuditExternal.enqueueInvitation.mockRejectedValueOnce(
            new Error('isolated queue failure'),
        )
        await expect(
            inviteStaffService(input, ADMIN_ACTOR_ID),
        ).resolves.toEqual({ success: false, error: 'deliveryFailed' })
        expect(adminAuditDb.state.rows.staffInvitations).toEqual([])
        const token = await sendInvitation()
        const [invitation] = await getStaffInvitationsService(ADMIN_ACTOR_ID)
        await manageStaffInvitationService(
            { id: invitation.id, action: 'revoke' },
            ADMIN_ACTOR_ID,
        )
        expect(await acceptStaffInvitationService({ token, password })).toEqual(
            { success: false },
        )
        expect(
            adminAuditDb.state.rows.auditLogs.map(({ action }) => action),
        ).toEqual([
            'admin.staff.invitation_created',
            'admin.staff.invitation_delivery_failed',
            'admin.staff.invitation_created',
            'admin.staff.invitation_revoked',
        ])
    })

    it('pauses acceptance, then applies edited permissions when the invitation is enabled again', async () => {
        const token = await sendInvitation()
        const [invitation] = await getStaffInvitationsService(ADMIN_ACTOR_ID)
        const id = invitation.id
        await expect(
            manageStaffInvitationService(
                { id, action: 'setActive', isActive: false },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: true })
        await expect(
            getStaffInvitationsService(ADMIN_ACTOR_ID),
        ).resolves.toMatchObject([{ status: 'disabled' }])
        await expect(
            acceptStaffInvitationService({ token, password }),
        ).resolves.toEqual({ success: false })

        const permissionKeys = [PERMISSIONS.USER_DASHBOARD]
        await expect(
            manageStaffInvitationService(
                {
                    id,
                    action: 'permissions',
                    expectedPermissionKeys: invitation.permissionKeys,
                    permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: false, error: 'invalidPermissions' })
        await expect(
            manageStaffInvitationService(
                {
                    id,
                    action: 'permissions',
                    permissionKeys,
                    expectedPermissionKeys: invitation.permissionKeys,
                },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: true })
        await expect(
            manageStaffInvitationService(
                {
                    id,
                    action: 'permissions',
                    permissionKeys: input.permissionKeys,
                    expectedPermissionKeys: invitation.permissionKeys,
                },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: false, error: 'permissionConflict' })
        await expect(
            getStaffInvitationsService(ADMIN_ACTOR_ID),
        ).resolves.toMatchObject([{ status: 'disabled', permissionKeys }])
        await expect(
            manageStaffInvitationService(
                { id, action: 'setActive', isActive: true },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: true })
        await expect(
            acceptStaffInvitationService({ token, password }),
        ).resolves.toEqual({ success: true })
        const user = adminAuditDb.state.rows.users.find(
            ({ email }) => email === input.email,
        )
        expect(
            adminAuditDb.state.rows.staffUserPermissions.filter(
                ({ userId }) => userId === user?.id,
            ),
        ).toMatchObject([
            { permissionId: 'permission:' + PERMISSIONS.USER_DASHBOARD },
        ])
    })

    it('queues replacement intent without a database lock, then rotates only on a worker commit and reuses the link on retry', async () => {
        const oldToken = await sendInvitation()
        const [invitation] = await getStaffInvitationsService(ADMIN_ACTOR_ID)
        const data = { id: invitation.id, action: 'resend' as const }
        adminAuditExternal.enqueueInvitationResend.mockRejectedValueOnce(
            new Error('isolated queue failure'),
        )
        await expect(
            manageStaffInvitationService(data, ADMIN_ACTOR_ID),
        ).resolves.toEqual({ success: false, error: 'deliveryFailed' })
        expect(adminAuditDb.state.rows.staffInvitations[0].tokenHash).toBe(
            await createTokenHash(oldToken),
        )
        expect(
            adminAuditDb.state.rows.auditLogs.map(({ action }) => action),
        ).toEqual(['admin.staff.invitation_created'])

        adminAuditDb.state.rows.staffInvitations[0].expiresAt = new Date(0)
        await expect(
            getStaffInvitationsService(ADMIN_ACTOR_ID),
        ).resolves.toMatchObject([{ status: 'expired' }])
        await expect(
            manageStaffInvitationService(
                { id: invitation.id, action: 'setActive', isActive: true },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({ success: false, error: 'expired' })
        adminAuditExternal.enqueueInvitationResend.mockImplementationOnce(
            async () => {
                expect(adminAuditDb.state.activeTransaction).toBe(0)
            },
        )
        await expect(
            manageStaffInvitationService(data, ADMIN_ACTOR_ID),
        ).resolves.toEqual({ success: true })
        const job =
            adminAuditExternal.enqueueInvitationResend.mock.lastCall?.[0]
        if (!job) throw new Error('Expected a queued resend')
        const newToken = invitationToken(job.resetLink)
        expect(newToken).not.toBe(oldToken)
        const oldHash = await createTokenHash(oldToken)
        expect(adminAuditDb.state.rows.staffInvitations[0].tokenHash).toBe(
            oldHash,
        )

        adminAuditDb.state.failCommitTransaction =
            adminAuditDb.state.nextTransaction + 1
        await expect(
            prepareStaffInvitationResendMailService(job),
        ).rejects.toThrow('Injected transaction commit failure')
        expect(adminAuditDb.state.rows.staffInvitations[0].tokenHash).toBe(
            oldHash,
        )
        const mail = await prepareStaffInvitationResendMailService(job)
        expect(mail).toEqual({
            to: input.email,
            username: input.username,
            resetLink: job.resetLink,
        })
        const expiresAt = adminAuditDb.state.rows.staffInvitations[0].expiresAt
        await expect(
            prepareStaffInvitationResendMailService(job),
        ).resolves.toEqual(mail)
        expect(adminAuditDb.state.rows.staffInvitations[0].expiresAt).toEqual(
            expiresAt,
        )
        expect(
            adminAuditDb.state.rows.auditLogs.filter(
                ({ action }) => action === 'admin.staff.invitation_resent',
            ),
        ).toHaveLength(1)
        await expect(
            acceptStaffInvitationService({ token: oldToken, password }),
        ).resolves.toEqual({ success: false })
        await expect(
            acceptStaffInvitationService({ token: newToken, password }),
        ).resolves.toEqual({ success: true })
    })

    it('drops a queued resend when the invitation is subsequently disabled', async () => {
        await sendInvitation()
        const [invitation] = await getStaffInvitationsService(ADMIN_ACTOR_ID)
        await manageStaffInvitationService(
            { id: invitation.id, action: 'resend' },
            ADMIN_ACTOR_ID,
        )
        const job =
            adminAuditExternal.enqueueInvitationResend.mock.lastCall?.[0]
        if (!job) throw new Error('Expected a queued resend')
        await manageStaffInvitationService(
            { id: invitation.id, action: 'setActive', isActive: false },
            ADMIN_ACTOR_ID,
        )
        await expect(
            prepareStaffInvitationResendMailService(job),
        ).resolves.toBeNull()
    })
})
