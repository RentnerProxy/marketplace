import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    ADMIN_ACTOR_ID,
    ADMIN_TARGET_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from './admin-audit.test.helpers.ts'

installAdminAuditTestMocks()
const { resetUserPasswordService } =
    await import('@/server/Admin/UserManagement/password.service.ts')

describe('Admin Password-Reset', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
    })

    it('revalidiert die Admin-Berechtigung nach sortierten Userlocks in der Token-Transaktion', async function () {
        const result = await resetUserPasswordService({ id: ADMIN_TARGET_ID })
        expect(result).toEqual({ success: true })
        expect(
            adminAuditDb.state.events.filter(
                (event) => event.operation === 'begin',
            ),
        ).toHaveLength(1)
        expect(
            adminAuditDb.state.events
                .filter((event) => event.operation === 'lock:update')
                .slice(0, 2)
                .map((event) => event.ids),
        ).toEqual([[ADMIN_TARGET_ID], [ADMIN_ACTOR_ID]])
        expect(adminAuditDb.state.rows.passwordResetTokens).toHaveLength(1)
        expect(
            adminAuditDb.state.rows.passwordResetTokens[0].tokenHash,
        ).not.toBe('older-token-hash')
        expect(adminAuditDb.state.rows.auditLogs[0]).toMatchObject({
            actorUserId: ADMIN_ACTOR_ID,
            action: 'admin.user.password_reset_requested',
        })
        expect(adminAuditExternal.enqueueReset).toHaveBeenCalledTimes(1)
    })

    it('erstellt nach zwischenzeitlichem Berechtigungsentzug kein Token', async function () {
        adminAuditDb.state.rows.userPermissions =
            adminAuditDb.state.rows.userPermissions.filter(
                (row) => row.userId !== ADMIN_ACTOR_ID,
            )
        const before = structuredClone(adminAuditDb.state.rows)
        const result = await resetUserPasswordService({ id: ADMIN_TARGET_ID })
        expect(result).toEqual({
            success: false,
            error: 'Dir fehlt die erforderliche Berechtigung.',
        })
        expect(adminAuditDb.state.rows).toEqual(before)
        expect(
            adminAuditDb.state.events.some(
                (event) =>
                    event.operation === 'insert' ||
                    event.operation === 'delete',
            ),
        ).toBe(false)
        expect(adminAuditExternal.enqueueReset).not.toHaveBeenCalled()
    })

    it('erstellt für deaktivierte Benutzer weder Token noch Mail-Job', async function () {
        adminAuditDb.state.rows.users[0].isActive = false
        const before = structuredClone(adminAuditDb.state.rows)
        const result = await resetUserPasswordService({ id: ADMIN_TARGET_ID })
        expect(result).toEqual({
            success: false,
            error: 'Für deaktivierte Benutzer kann kein Passwort-Reset versendet werden.',
        })
        expect(adminAuditDb.state.rows).toEqual(before)
        expect(
            adminAuditDb.state.events.some(
                (event) =>
                    event.operation === 'insert' ||
                    event.operation === 'delete',
            ),
        ).toBe(false)
        expect(adminAuditExternal.enqueueReset).not.toHaveBeenCalled()
    })

    it('löscht bei Queue-Fehlern nur das selbst erzeugte Token und auditiert die Kompensation', async function () {
        const otherToken = {
            userId: ADMIN_ACTOR_ID,
            tokenHash: 'other-user-token',
        }
        adminAuditDb.state.rows.passwordResetTokens.push(otherToken)
        adminAuditExternal.enqueueReset.mockRejectedValueOnce(
            new Error('Queue nicht erreichbar'),
        )
        const result = await resetUserPasswordService({ id: ADMIN_TARGET_ID })
        expect(result).toMatchObject({ success: false })
        expect(adminAuditDb.state.rows.passwordResetTokens).toEqual([
            otherToken,
        ])
        expect(
            adminAuditDb.state.rows.auditLogs.map((row) => row.action),
        ).toEqual([
            'admin.user.password_reset_requested',
            'admin.user.password_reset_cancelled',
        ])
        expect(
            adminAuditDb.state.events.filter(
                (event) => event.operation === 'commit',
            ),
        ).toHaveLength(2)
    })
})
