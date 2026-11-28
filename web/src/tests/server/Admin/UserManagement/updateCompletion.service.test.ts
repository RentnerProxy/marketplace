import type { SuccessfulUserUpdateTransaction } from '@/server/Admin/UserManagement/Types/user-update.types.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'

import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import {
    ADMIN_ACTOR_ID,
    ADMIN_TARGET_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from './admin-audit.test.helpers.ts'

installAdminAuditTestMocks()
const { completeUserUpdateService } =
    await import('@/server/Admin/UserManagement/updateCompletion.service.ts')
const { prepareAuditContextService, writeAuditLogInTransactionService } =
    await import('@/lib/AuditLogs/auditLogs.ts')

function changedUser(audit: AuditReceipt): SuccessfulUserUpdateTransaction {
    return {
        success: true,
        audit,
        user: {
            id: ADMIN_TARGET_ID,
            username: 'test-user',
            email: 'new@example.test',
            isActive: true,
            accountType: 'public',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        userProfile: { profileImageUpdatedAt: null },
        previousUser: {
            username: 'test-user',
            email: 'previous@example.test',
            isActive: true,
            isDeleted: false,
        },
        previousPermissionKeys: ['user.dashboard'],
        permissionKeys: ['user.dashboard'],
    }
}

describe('Admin user update audit actor after session revocation', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
    })

    it.each([
        { actorUserId: ADMIN_TARGET_ID, isCurrentUser: true },
        { actorUserId: ADMIN_ACTOR_ID, isCurrentUser: false },
        { actorUserId: null, isCurrentUser: false },
    ])(
        'publishes the committed explicit actor without looking up a deleted session or writing another audit',
        async function ({ actorUserId, isCurrentUser }) {
            const context = prepareAuditContextService(actorUserId)
            const audit = await adminAuditDb.db.transaction(async (tx) =>
                writeAuditLogInTransactionService(tx as never, {
                    ...context,
                    action: 'admin.user.updated',
                    oldValues: { email: 'previous@example.test' },
                    newValues: { email: 'new@example.test' },
                }),
            )
            adminAuditDb.state.rows.sessions = []
            const eventsAtCommit = structuredClone(adminAuditDb.state.events)
            const result = await completeUserUpdateService(
                changedUser(audit),
                actorUserId,
            )

            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(adminAuditDb.state.rows.auditLogs[0]).toMatchObject({
                actorUserId,
                action: 'admin.user.updated',
                oldValues: { email: 'previous@example.test' },
                newValues: { email: 'new@example.test' },
            })
            expect(adminAuditExternal.getCookie).not.toHaveBeenCalled()
            expect(adminAuditDb.state.events).toEqual(eventsAtCommit)
            expect(adminAuditExternal.logError).not.toHaveBeenCalled()
            expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
            expect(adminAuditExternal.publishUser).toHaveBeenCalledTimes(1)
            expect(result.isCurrentUser).toBe(isCurrentUser)
            expect(result.email).toBe('new@example.test')
            expect(result).not.toHaveProperty('actorUserId')
            expect(result).not.toHaveProperty('audit')
            expect(result).not.toHaveProperty('notification')
        },
    )
})
