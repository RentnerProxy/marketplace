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
const {
    getStaffInvitationsService,
    inviteStaffService,
    revokeStaffInvitationService,
} = await import('@/server/Admin/StaffManagement/invitations.service.ts')
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
    const payload = adminAuditExternal.enqueueInvitation.mock.lastCall?.[0]
    if (!payload) throw new Error('Expected a queued invitation')
    const token = new URLSearchParams(
        new URL(payload.resetLink).hash.slice(1),
    ).get('invite')
    if (!token) throw new Error('Expected a fragment-only invitation token')
    return token
}

beforeEach(() => {
    vi.clearAllMocks()
    adminAuditDb.reset()
    adminAuditExternal.enqueueInvitation.mockResolvedValue(undefined)
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
        await revokeStaffInvitationService(invitation.id, ADMIN_ACTOR_ID)
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
})
