import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { UpdateUserProfileInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import {
    ADMIN_ACTOR_ID,
    ADMIN_TARGET_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from './admin-audit.test.helpers.ts'
installAdminAuditTestMocks()
const { updateUserProfileService } =
    await import('@/server/Admin/UserManagement/update.service.ts')
const { setUserActiveService } =
    await import('@/server/Admin/UserManagement/active.service.ts')
const { deleteUserService } =
    await import('@/server/Admin/UserManagement/delete.service.ts')
const { createUserService } =
    await import('@/server/Admin/UserManagement/create.service.ts')
const { resetUserPasswordService } =
    await import('@/server/Admin/UserManagement/password.service.ts')

function updateInput(id = ADMIN_TARGET_ID): UpdateUserProfileInput {
    const user = adminAuditDb.state.rows.users.find((row) => row.id === id)!
    return {
        id,
        username: String(user.username),
        email: 'changed@example.test',
        firstName: 'After',
        lastName: '',
        street: '',
        houseNumber: '',
        postalCode: '',
        city: '',
    }
}
function expectNoPublishing() {
    expect(adminAuditExternal.publishAudit).not.toHaveBeenCalled()
    expect(adminAuditExternal.publishUser).not.toHaveBeenCalled()
    expect(adminAuditExternal.publishNotification).not.toHaveBeenCalled()
    expect(adminAuditExternal.publishRevocation).not.toHaveBeenCalled()
}
describe('Administrative mutations with required audit persistence', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
        for (const publisher of [
            adminAuditExternal.publishAudit,
            adminAuditExternal.publishUser,
            adminAuditExternal.publishNotification,
            adminAuditExternal.publishRevocation,
        ]) {
            publisher.mockImplementation(async function () {
                expect(adminAuditDb.state.activeTransaction).toBe(0)
            })
        }
        adminAuditExternal.enqueueReset.mockImplementation(async function () {
            expect(adminAuditDb.state.activeTransaction).toBe(0)
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        })
        adminAuditExternal.enqueueInvitation.mockImplementation(
            async function () {
                expect(adminAuditDb.state.activeTransaction).toBe(0)
                expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            },
        )
    })
    it('commits profile, identity, revocation and audit together', async function () {
        const previousPermissions = structuredClone(
            adminAuditDb.state.rows.userPermissions,
        )
        const result = await updateUserProfileService(updateInput())
        expect(result.success).toBe(true)
        const rows = adminAuditDb.state.rows
        expect(rows.userPermissions).toEqual(previousPermissions)
        expect(
            rows.users.find((row) => row.id === ADMIN_TARGET_ID)?.email,
        ).toBe('changed@example.test')
        expect(
            rows.user_profiles.find((row) => row.userId === ADMIN_TARGET_ID)
                ?.firstName,
        ).toBe('After')
        expect(
            rows.sessions.some((row) => row.userId === ADMIN_TARGET_ID),
        ).toBe(false)
        expect(rows.trustedDevices).toHaveLength(0)
        expect(rows.passwordResetTokens).toHaveLength(0)
        expect(rows.notifications).toHaveLength(0)
        expect(rows.auditLogs).toHaveLength(1)
        expect(rows.auditLogs[0]).toMatchObject({
            actorUserId: ADMIN_ACTOR_ID,
            action: 'admin.user.updated',
            route: '/admin/users',
            oldValues: { email: 'target@example.test' },
            newValues: { email: 'changed@example.test' },
        })
        const events = adminAuditDb.state.events
        expect(
            events
                .filter(
                    (event) =>
                        event.table === 'users' &&
                        event.operation === 'lock:update',
                )
                .slice(0, 2)
                .map((event) => event.ids),
        ).toEqual([[ADMIN_TARGET_ID], [ADMIN_ACTOR_ID]])
        const permissionLock = events.findIndex(
            (event) =>
                event.table === 'permissions' &&
                event.operation === 'lock:update',
        )
        expect(permissionLock).toBeGreaterThan(2)
        expect(
            events
                .filter((event) =>
                    ['insert', 'update', 'delete'].includes(event.operation),
                )
                .every((event) => event.transaction === 1),
        ).toBe(true)
        expect(result).not.toHaveProperty('audit')
        expect(result).not.toHaveProperty('notification')
        expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishNotification).not.toHaveBeenCalled()
        expect(adminAuditExternal.publishUser).toHaveBeenCalledTimes(1)
    })
    it('preserves the verified actor after revoking the admin own session', async function () {
        const input = updateInput(ADMIN_ACTOR_ID)
        const result = await updateUserProfileService(input)
        expect(result.success).toBe(true)
        expect(
            adminAuditDb.state.rows.sessions.some(
                (row) => row.userId === ADMIN_ACTOR_ID,
            ),
        ).toBe(false)
        expect(adminAuditDb.state.rows.auditLogs[0].actorUserId).toBe(
            ADMIN_ACTOR_ID,
        )
        expect(adminAuditExternal.getCookie).not.toHaveBeenCalled()
    })
    it.each(['auditLogs'])(
        'rolls back every dependent mutation when %s persistence fails',
        async function (table) {
            const previous = structuredClone(adminAuditDb.state.rows)
            adminAuditDb.state.failTable = table
            await expect(
                updateUserProfileService(updateInput()),
            ).rejects.toThrow('Injected persistence failure')
            expect(adminAuditDb.state.rows).toEqual(previous)
            expect(adminAuditDb.state.events.at(-1)?.operation).toBe('rollback')
            expectNoPublishing()
        },
    )
    it('rejects an empty audit receipt and rolls back profile and identity changes', async function () {
        const previous = structuredClone(adminAuditDb.state.rows)
        adminAuditDb.state.emptyAuditReceipt = true
        await expect(updateUserProfileService(updateInput())).rejects.toThrow(
            'persisted receipt',
        )
        expect(adminAuditDb.state.rows).toEqual(previous)
        expectNoPublishing()
    })
    it('keeps committed changes when all independent publishers fail', async function () {
        for (const publisher of [
            adminAuditExternal.publishAudit,
            adminAuditExternal.publishNotification,
            adminAuditExternal.publishUser,
        ]) {
            publisher.mockRejectedValueOnce(new Error('Publisher offline'))
        }
        await expect(
            updateUserProfileService(updateInput()),
        ).resolves.toMatchObject({
            success: true,
        })
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        expect(adminAuditDb.state.rows.notifications).toHaveLength(0)
        expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishNotification).not.toHaveBeenCalled()
        expect(adminAuditExternal.publishUser).toHaveBeenCalledTimes(1)
    })
    it.each(['deactivate', 'delete'])(
        'rolls back %s and authentication revocation on audit failure',
        async function (operation) {
            const previous = structuredClone(adminAuditDb.state.rows)
            adminAuditDb.state.failTable = 'auditLogs'
            await expect(
                operation === 'delete'
                    ? deleteUserService({ id: ADMIN_TARGET_ID })
                    : setUserActiveService({
                          id: ADMIN_TARGET_ID,
                          isActive: false,
                      }),
            ).rejects.toThrow('Injected persistence failure')
            expect(adminAuditDb.state.rows).toEqual(previous)
            expectNoPublishing()
        },
    )
    it.each(['deactivate', 'delete'])(
        'audits %s even if its revocation publisher fails',
        async function (operation) {
            adminAuditExternal.publishRevocation.mockRejectedValueOnce(
                new Error('Realtime offline'),
            )
            await expect(
                operation === 'delete'
                    ? deleteUserService({ id: ADMIN_TARGET_ID })
                    : setUserActiveService({
                          id: ADMIN_TARGET_ID,
                          isActive: false,
                      }),
            ).resolves.toEqual({ success: true })
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(adminAuditDb.state.rows.auditLogs[0].actorUserId).toBe(
                ADMIN_ACTOR_ID,
            )
            expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
        },
    )
    it('does not mutate after actor permission loss', async function () {
        adminAuditDb.state.rows.userPermissions =
            adminAuditDb.state.rows.userPermissions.filter(
                (row) => row.userId !== ADMIN_ACTOR_ID,
            )
        const previous = structuredClone(adminAuditDb.state.rows)
        await expect(
            updateUserProfileService(updateInput()),
        ).resolves.toMatchObject({
            success: false,
        })
        expect(adminAuditDb.state.rows).toEqual(previous)
        expectNoPublishing()
    })
    it.each([
        { kind: 'reset', durationMs: 60 * 60_000 },
        { kind: 'invitation', durationMs: 24 * 60 * 60_000 },
    ])(
        'queues a fragment-only $kind link with the original token lifetime and hash',
        async function (flow) {
            const beforeMs = Date.now()
            const result =
                flow.kind === 'reset'
                    ? await resetUserPasswordService({ id: ADMIN_TARGET_ID })
                    : await createUserService({
                          username: 'new-user',
                          email: 'new-user@example.test',
                      })
            const afterMs = Date.now()
            expect(result.success).toBe(true)

            const queue =
                flow.kind === 'reset'
                    ? adminAuditExternal.enqueueReset
                    : adminAuditExternal.enqueueInvitation
            expect(queue).toHaveBeenCalledTimes(1)
            const mail = queue.mock.calls[0]?.[0]
            if (!mail) throw new Error('Expected a queued authentication mail')
            const resetUrl = new URL(mail.resetLink)
            const token = new URLSearchParams(resetUrl.hash.slice(1)).get(
                'token',
            )
            if (!token) throw new Error('Expected a fragment token')
            expect(token).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            )
            expect(mail).toEqual({
                to:
                    flow.kind === 'reset'
                        ? 'target@example.test'
                        : 'new-user@example.test',
                username: flow.kind === 'reset' ? 'target' : 'new-user',
                resetLink: resetUrl.origin + '/password-reset#token=' + token,
            })
            expect(resetUrl.pathname).toBe('/password-reset')
            expect(resetUrl.search).toBe('')
            expect(resetUrl.hash).toBe('#token=' + token)

            const recipient = adminAuditDb.state.rows.users.find(
                (row) => row.email === mail.to,
            )
            if (!recipient) throw new Error('Expected the mail recipient')
            const persistedToken =
                adminAuditDb.state.rows.passwordResetTokens.find(
                    (row) => row.userId === recipient.id,
                )
            if (!(persistedToken?.expiresAt instanceof Date))
                throw new Error('Expected the original token expiration')
            const tokenHash = await createTokenHash(token)
            expect(persistedToken.tokenHash).toBe(tokenHash)
            expect(persistedToken.tokenHash).not.toBe(token)
            expect(persistedToken.expiresAt.getTime()).toBeGreaterThanOrEqual(
                beforeMs + flow.durationMs,
            )
            expect(persistedToken.expiresAt.getTime()).toBeLessThanOrEqual(
                afterMs + flow.durationMs,
            )
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(adminAuditDb.state.rows.auditLogs[0].action).toBe(
                flow.kind === 'reset'
                    ? 'admin.user.password_reset_requested'
                    : 'admin.user.created',
            )
            for (const serialized of [
                JSON.stringify(result),
                JSON.stringify(adminAuditDb.state.rows.auditLogs),
            ]) {
                expect(serialized).not.toContain(token)
                expect(serialized).not.toContain(tokenHash)
            }
        },
    )
    it('does not enqueue a reset and preserves the previous token when required audit fails', async function () {
        const previous = structuredClone(adminAuditDb.state.rows)
        adminAuditDb.state.failTable = 'auditLogs'
        await expect(
            resetUserPasswordService({ id: ADMIN_TARGET_ID }),
        ).rejects.toThrow('Injected persistence failure')
        expect(adminAuditDb.state.rows).toEqual(previous)
        expect(adminAuditExternal.enqueueReset).not.toHaveBeenCalled()
        expectNoPublishing()
    })
    it('audits the exact reset-token cancellation in its own transaction', async function () {
        adminAuditExternal.enqueueReset.mockRejectedValueOnce(
            new Error('Queue unavailable'),
        )
        await expect(
            resetUserPasswordService({ id: ADMIN_TARGET_ID }),
        ).resolves.toMatchObject({ success: false })
        expect(adminAuditDb.state.rows.passwordResetTokens).toHaveLength(0)
        expect(
            adminAuditDb.state.rows.auditLogs.map((row) => row.action),
        ).toEqual([
            'admin.user.password_reset_requested',
            'admin.user.password_reset_cancelled',
        ])
        expect(
            adminAuditDb.state.rows.auditLogs.every(
                (row) => row.actorUserId === ADMIN_ACTOR_ID,
            ),
        ).toBe(true)
        expect(
            adminAuditDb.state.events.filter(
                (event) => event.operation === 'commit',
            ),
        ).toHaveLength(2)
    })
    it('keeps a newer reset token when an older queue request fails', async function () {
        adminAuditExternal.enqueueReset.mockImplementationOnce(
            async function () {
                adminAuditDb.state.rows.passwordResetTokens = [
                    { userId: ADMIN_TARGET_ID, tokenHash: 'newer-token' },
                ]
                throw new Error('Queue unavailable')
            },
        )
        await expect(
            resetUserPasswordService({ id: ADMIN_TARGET_ID }),
        ).resolves.toMatchObject({ success: false })
        expect(adminAuditDb.state.rows.passwordResetTokens[0].tokenHash).toBe(
            'newer-token',
        )
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
    })
    it('rolls cancellation back and surfaces its audit failure', async function () {
        adminAuditExternal.enqueueReset.mockRejectedValueOnce(
            new Error('Queue unavailable'),
        )
        adminAuditDb.state.failAuditAction =
            'admin.user.password_reset_cancelled'
        await expect(
            resetUserPasswordService({ id: ADMIN_TARGET_ID }),
        ).rejects.toThrow('Injected persistence failure')
        expect(adminAuditDb.state.rows.passwordResetTokens).toHaveLength(1)
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        expect(adminAuditDb.state.events.at(-1)?.operation).toBe('rollback')
    })
    it('does not create a user or enqueue an invitation on audit failure', async function () {
        const previous = structuredClone(adminAuditDb.state.rows)
        adminAuditDb.state.failTable = 'auditLogs'
        await expect(
            createUserService({
                username: 'new-user',
                email: 'new-user@example.test',
            }),
        ).rejects.toThrow('Injected persistence failure')
        expect(adminAuditDb.state.rows).toEqual(previous)
        expect(adminAuditExternal.enqueueInvitation).not.toHaveBeenCalled()
        expectNoPublishing()
    })
    it('audits creation and the full invitation compensation without exposing the password hash', async function () {
        adminAuditExternal.enqueueInvitation.mockRejectedValueOnce(
            new Error('Queue unavailable'),
        )
        await expect(
            createUserService({
                username: 'new-user',
                email: 'new-user@example.test',
            }),
        ).resolves.toMatchObject({ success: false })
        expect(adminAuditDb.state.rows.users).toHaveLength(2)
        expect(adminAuditDb.state.rows.user_profiles).toHaveLength(2)
        expect(adminAuditDb.state.rows.passwordResetTokens).toHaveLength(1)
        expect(
            adminAuditDb.state.rows.auditLogs.map((row) => row.action),
        ).toEqual(['admin.user.created', 'admin.user.creation_rolled_back'])
        expect(JSON.stringify(adminAuditDb.state.rows.auditLogs)).not.toContain(
            'passwordHash',
        )
    })
    it.each([
        'passwordHash',
        'email',
        'username',
        'isActive',
        'isDeleted',
        'isTwoFactorEnabled',
    ])(
        'preserves the created account if its %s changes before compensation',
        async function (field) {
            adminAuditExternal.enqueueInvitation.mockImplementationOnce(
                async function () {
                    const created = adminAuditDb.state.rows.users.find(
                        (row) => row.username === 'new-user',
                    )!
                    created[field] =
                        field === 'isActive'
                            ? false
                            : ['isDeleted', 'isTwoFactorEnabled'].includes(
                                    field,
                                )
                              ? true
                              : 'concurrent-change'
                    throw new Error('Queue unavailable')
                },
            )
            await expect(
                createUserService({
                    username: 'new-user',
                    email: 'new-user@example.test',
                }),
            ).resolves.toMatchObject({ success: false })
            expect(adminAuditDb.state.rows.users).toHaveLength(3)
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        },
    )
    it.each([
        'superuser-permission',
        'removed-permission',
        'profile',
        'profile-image',
        'token-hash',
        'token-expiry',
        'additional-token',
    ])(
        'preserves the created account and dependent rows after a concurrent %s change',
        async function (change) {
            let preservedRows = structuredClone(adminAuditDb.state.rows)
            adminAuditExternal.enqueueInvitation.mockImplementationOnce(
                async function () {
                    const created = adminAuditDb.state.rows.users.find(
                        (row) => row.username === 'new-user',
                    )!
                    const profile = adminAuditDb.state.rows.user_profiles.find(
                        (row) => row.userId === created.id,
                    )!
                    const invitation =
                        adminAuditDb.state.rows.passwordResetTokens.find(
                            (row) => row.userId === created.id,
                        )!
                    if (change === 'superuser-permission')
                        adminAuditDb.state.rows.userPermissions.push({
                            userId: created.id,
                            permissionId:
                                'permission:' + PERMISSIONS.ADMIN_SUPER_USER,
                        })
                    if (change === 'removed-permission')
                        adminAuditDb.state.rows.userPermissions =
                            adminAuditDb.state.rows.userPermissions.filter(
                                (row) => row.userId !== created.id,
                            )
                    if (change === 'profile')
                        profile.firstName = 'Changed elsewhere'
                    if (change === 'profile-image')
                        profile.profileImageUpdatedAt = new Date(
                            '2026-09-06T13:00:00.000Z',
                        )
                    if (change === 'token-hash')
                        invitation.tokenHash = 'later-reset-token'
                    if (change === 'token-expiry')
                        invitation.expiresAt = new Date(
                            '2035-01-01T00:00:00.000Z',
                        )
                    if (change === 'additional-token')
                        adminAuditDb.state.rows.passwordResetTokens.push({
                            userId: created.id,
                            tokenHash: 'additional-token',
                        })
                    preservedRows = structuredClone(adminAuditDb.state.rows)
                    throw new Error('Queue unavailable')
                },
            )
            await expect(
                createUserService({
                    username: 'new-user',
                    email: 'new-user@example.test',
                }),
            ).resolves.toMatchObject({ success: false })
            expect(adminAuditDb.state.rows).toEqual(preservedRows)
            expect(adminAuditDb.state.rows.users).toHaveLength(3)
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(
                adminAuditDb.state.events.some(
                    (event) =>
                        event.operation === 'delete' && event.table === 'users',
                ),
            ).toBe(false)
        },
    )

    it('rolls the creation compensation back if its own required audit fails', async function () {
        adminAuditExternal.enqueueInvitation.mockRejectedValueOnce(
            new Error('Queue unavailable'),
        )
        adminAuditDb.state.failAuditAction = 'admin.user.creation_rolled_back'
        await expect(
            createUserService({
                username: 'new-user',
                email: 'new-user@example.test',
            }),
        ).rejects.toThrow('Injected persistence failure')
        expect(adminAuditDb.state.rows.users).toHaveLength(3)
        expect(adminAuditDb.state.rows.user_profiles).toHaveLength(3)
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
    })
})
