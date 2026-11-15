import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    ADMIN_ACTOR_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from '../UserManagement/admin-audit.test.helpers.ts'
installAdminAuditTestMocks()
const { replaceDefaultPermissionsService } =
    await import('@/server/Admin/PermissionManagement/defaults.service.ts')
describe('Required audit for default permission changes', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
    })
    it('locks the actor before permission rows and commits the audit with the defaults', async function () {
        adminAuditExternal.publishPermissions.mockImplementationOnce(
            async function () {
                expect(adminAuditDb.state.activeTransaction).toBe(0)
                expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            },
        )
        await expect(
            replaceDefaultPermissionsService(
                { permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD] },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toEqual({
            success: true,
            changed: true,
            previousPermissionKeys: [PERMISSIONS.USER_DASHBOARD],
            permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
        })
        expect(adminAuditDb.state.events[1]).toMatchObject({
            table: 'users',
            operation: 'lock:update',
            ids: [ADMIN_ACTOR_ID],
        })
        expect(adminAuditDb.state.events[2]).toMatchObject({
            table: 'permissions',
            operation: 'lock:update',
        })
        expect(adminAuditDb.state.rows.auditLogs[0].action).toBe(
            'admin.permissions.defaults.updated',
        )
        expect(adminAuditExternal.publishPermissions).toHaveBeenCalledTimes(1)
    })
    it('rolls default deletion and insertion back on audit failure', async function () {
        const before = structuredClone(adminAuditDb.state.rows)
        adminAuditDb.state.failTable = 'auditLogs'
        await expect(
            replaceDefaultPermissionsService(
                { permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD] },
                ADMIN_ACTOR_ID,
            ),
        ).rejects.toThrow('Injected persistence failure')
        expect(adminAuditDb.state.rows).toEqual(before)
        expect(adminAuditExternal.publishPermissions).not.toHaveBeenCalled()
    })
    it.each([
        { permissionKeys: [PERMISSIONS.USER_DASHBOARD] },
        { permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER] },
        { permissionKeys: ['unknown.permission'] },
    ])(
        'keeps the no-op or rejected selection %j without audit writes',
        async function ({ permissionKeys }) {
            const before = structuredClone(adminAuditDb.state.rows)
            await replaceDefaultPermissionsService(
                { permissionKeys: [...permissionKeys] },
                ADMIN_ACTOR_ID,
            )
            expect(adminAuditDb.state.rows).toEqual(before)
            expect(adminAuditExternal.publishAudit).not.toHaveBeenCalled()
            expect(adminAuditExternal.publishPermissions).not.toHaveBeenCalled()
        },
    )
    it('preserves committed defaults when either publisher is unavailable', async function () {
        adminAuditExternal.publishAudit.mockRejectedValueOnce(
            new Error('Audit topic offline'),
        )
        adminAuditExternal.publishPermissions.mockRejectedValueOnce(
            new Error('Permissions topic offline'),
        )
        await expect(
            replaceDefaultPermissionsService(
                { permissionKeys: [] },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toMatchObject({ success: true, changed: true })
        expect(adminAuditDb.state.rows.defaultUserPermissions).toHaveLength(0)
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
        expect(adminAuditExternal.publishPermissions).toHaveBeenCalledTimes(1)
    })
})
