import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    ADMIN_ACTOR_ID,
    ADMIN_TARGET_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from '../UserManagement/admin-audit.test.helpers.ts'
installAdminAuditTestMocks()
const { replaceManagedUserPermissionsService } =
    await import('@/server/Admin/PermissionManagement/managed-user-permissions.service.ts')
const input = {
    userId: ADMIN_TARGET_ID,
    permissionKeys: [PERMISSIONS.USER_DASHBOARD, PERMISSIONS.ADMIN_DASHBOARD],
}

function expectNoWrites() {
    expect(
        adminAuditDb.state.events.filter((event) =>
            ['insert', 'update', 'delete'].includes(event.operation),
        ),
    ).toEqual([])
    expect(adminAuditExternal.publishAudit).not.toHaveBeenCalled()
    expect(adminAuditExternal.publishUser).not.toHaveBeenCalled()
    expect(adminAuditExternal.publishNotification).not.toHaveBeenCalled()
}
describe('replaceManagedUserPermissionsService', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
        for (const publisher of [
            adminAuditExternal.publishAudit,
            adminAuditExternal.publishUser,
            adminAuditExternal.publishNotification,
        ]) {
            publisher.mockImplementation(async function () {
                expect(adminAuditDb.state.activeTransaction).toBe(0)
                expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
                expect(adminAuditDb.state.rows.notifications).toHaveLength(1)
            })
        }
    })
    it.each(['missing', 'deleted'])(
        'beendet %s Targets ohne fachliche Seiteneffekte',
        async function (kind) {
            if (kind === 'missing')
                adminAuditDb.state.rows.users =
                    adminAuditDb.state.rows.users.filter(
                        (row) => row.id !== ADMIN_TARGET_ID,
                    )
            else adminAuditDb.state.rows.users[0].isDeleted = true
            await expect(
                replaceManagedUserPermissionsService(input, ADMIN_ACTOR_ID),
            ).resolves.toEqual({
                success: false,
                error: 'Benutzer wurde nicht gefunden.',
            })
            expectNoWrites()
        },
    )
    it.each(['inactive', 'without-permission'])(
        'schreibt für %s Actor keine Permissions',
        async function (kind) {
            if (kind === 'inactive')
                adminAuditDb.state.rows.users[1].isActive = false
            else
                adminAuditDb.state.rows.staffUserPermissions =
                    adminAuditDb.state.rows.staffUserPermissions.filter(
                        (row) => row.userId !== ADMIN_ACTOR_ID,
                    )
            await expect(
                replaceManagedUserPermissionsService(input, ADMIN_ACTOR_ID),
            ).resolves.toEqual({
                success: false,
                error: 'Dir fehlt die erforderliche Berechtigung.',
            })
            expectNoWrites()
        },
    )
    it('ersetzt Rechte mit Pflichtnotification und Audit atomar vor allen Publishern', async function () {
        const result = await replaceManagedUserPermissionsService(
            input,
            ADMIN_ACTOR_ID,
        )
        expect(result).toEqual({
            success: true,
            changed: true,
            username: 'target',
            previousPermissionKeys: [PERMISSIONS.USER_DASHBOARD],
            permissionKeys: input.permissionKeys,
            addedPermissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
            removedPermissionKeys: [],
        })
        const rows = adminAuditDb.state.rows
        expect(
            rows.staffUserPermissions
                .filter((row) => row.userId === ADMIN_TARGET_ID)
                .map((row) => row.permissionId),
        ).toEqual(input.permissionKeys.map((key) => 'permission:' + key))
        expect(rows.notifications[0]).toMatchObject({
            userId: ADMIN_TARGET_ID,
            type: 'permissions-added',
        })
        expect(rows.auditLogs[0]).toMatchObject({
            actorUserId: ADMIN_ACTOR_ID,
            action: 'admin.user.permissions.updated',
            oldValues: {
                userId: ADMIN_TARGET_ID,
                permissionKeys: [PERMISSIONS.USER_DASHBOARD],
            },
            newValues: {
                userId: ADMIN_TARGET_ID,
                permissionKeys: input.permissionKeys,
            },
        })
        const events = adminAuditDb.state.events
        expect(events.slice(1, 3).map((event) => event.ids)).toEqual([
            [ADMIN_TARGET_ID],
            [ADMIN_ACTOR_ID],
        ])
        expect(
            events
                .filter((event) =>
                    ['insert', 'delete'].includes(event.operation),
                )
                .every((event) => event.transaction === 1),
        ).toBe(true)
        expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishNotification).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishUser).toHaveBeenCalledTimes(1)
    })
    it('erzeugt bei unveränderten Rechten keine Side Effects und keine internen Responsefelder', async function () {
        await expect(
            replaceManagedUserPermissionsService(
                { ...input, permissionKeys: [PERMISSIONS.USER_DASHBOARD] },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({
            success: true,
            changed: false,
            username: 'target',
            previousPermissionKeys: [PERMISSIONS.USER_DASHBOARD],
            permissionKeys: [PERMISSIONS.USER_DASHBOARD],
            addedPermissionKeys: [],
            removedPermissionKeys: [],
        })
        expectNoWrites()
    })
    it('verhindert die Entmachtung des letzten aktiven Superusers', async function () {
        await expect(
            replaceManagedUserPermissionsService(
                { ...input, userId: ADMIN_ACTOR_ID },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({
            success: false,
            error: 'Der letzte aktive Superuser darf nicht entmachtet, deaktiviert oder gelöscht werden.',
        })
        expectNoWrites()
    })
    it('verweigert unbekannte Rechte ohne Mutation', async function () {
        await expect(
            replaceManagedUserPermissionsService(
                { ...input, permissionKeys: ['unknown.permission'] },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({
            success: false,
            error: 'Mindestens eine angegebene Berechtigung ist unbekannt.',
        })
        expectNoWrites()
    })
    it.each(['auditLogs', 'notifications'])(
        'rollt Rechte und Pflichtdaten bei %s-Ausfall vollständig zurück',
        async function (table) {
            const before = structuredClone(adminAuditDb.state.rows)
            adminAuditDb.state.failTable = table
            await expect(
                replaceManagedUserPermissionsService(input, ADMIN_ACTOR_ID),
            ).rejects.toThrow('Injected persistence failure')
            expect(adminAuditDb.state.rows).toEqual(before)
            expect(adminAuditDb.state.events.at(-1)?.operation).toBe('rollback')
            expect(adminAuditExternal.publishUser).not.toHaveBeenCalled()
            expect(adminAuditExternal.publishAudit).not.toHaveBeenCalled()
            expect(
                adminAuditExternal.publishNotification,
            ).not.toHaveBeenCalled()
        },
    )
    it('meldet nach Commit trotz aller Publisherausfälle Erfolg', async function () {
        for (const publisher of [
            adminAuditExternal.publishAudit,
            adminAuditExternal.publishUser,
            adminAuditExternal.publishNotification,
        ]) {
            publisher.mockRejectedValueOnce(new Error('Realtime offline'))
        }
        await expect(
            replaceManagedUserPermissionsService(input, ADMIN_ACTOR_ID),
        ).resolves.toMatchObject({ success: true, changed: true })
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        expect(adminAuditDb.state.rows.notifications).toHaveLength(1)
        expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishNotification).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.publishUser).toHaveBeenCalledTimes(1)
        expect(adminAuditExternal.logError).toHaveBeenCalledTimes(3)
    })
})
