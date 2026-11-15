import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    ADMIN_ACTOR_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from '../UserManagement/admin-audit.test.helpers.ts'
installAdminAuditTestMocks()
const {
    createPermissionPresetService,
    updatePermissionPresetService,
    deletePermissionPresetService,
} = await import('@/server/Admin/PermissionManagement/presets.service.ts')
const presetId = '00000000-0000-4000-8000-000000000010'
function mutate(operation: string) {
    if (operation === 'create')
        return createPermissionPresetService(
            {
                name: 'New preset',
                description: '',
                permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
            },
            ADMIN_ACTOR_ID,
        )
    if (operation === 'update')
        return updatePermissionPresetService(
            {
                id: presetId,
                name: 'Updated preset',
                description: 'After',
                permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
            },
            ADMIN_ACTOR_ID,
        )
    return deletePermissionPresetService({ id: presetId }, ADMIN_ACTOR_ID)
}
describe('Required preset audit persistence', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        adminAuditDb.reset()
        adminAuditDb.state.rows.permissionPresets = [
            {
                id: presetId,
                name: 'Original preset',
                description: '',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                updatedAt: new Date('2026-01-01T00:00:00Z'),
            },
        ]
        adminAuditDb.state.rows.permissionPresetPermissions = [
            {
                presetId,
                permissionId: 'permission:' + PERMISSIONS.USER_DASHBOARD,
            },
        ]
    })
    it.each(['create', 'update', 'delete'])(
        'commits %s with exactly one audit and actor-first locks',
        async function (operation) {
            const result = await mutate(operation)
            expect(result.success).toBe(true)
            expect(result).not.toHaveProperty('audit')
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(adminAuditDb.state.rows.auditLogs[0].actorUserId).toBe(
                ADMIN_ACTOR_ID,
            )
            expect(adminAuditDb.state.events[1]).toMatchObject({
                table: 'users',
                operation: 'lock:update',
                ids: [ADMIN_ACTOR_ID],
            })
            expect(adminAuditDb.state.events[2]).toMatchObject({
                table: 'permissions',
                operation: 'lock:update',
            })
            expect(adminAuditExternal.publishAudit).toHaveBeenCalledTimes(1)
            expect(adminAuditExternal.publishPermissions).toHaveBeenCalledTimes(
                1,
            )
        },
    )
    it.each(['create', 'update', 'delete'])(
        'rolls the complete %s operation back when audit persistence fails',
        async function (operation) {
            const before = structuredClone(adminAuditDb.state.rows)
            adminAuditDb.state.failTable = 'auditLogs'
            await expect(mutate(operation)).rejects.toThrow(
                'Injected persistence failure',
            )
            expect(adminAuditDb.state.rows).toEqual(before)
            expect(adminAuditExternal.publishAudit).not.toHaveBeenCalled()
            expect(adminAuditExternal.publishPermissions).not.toHaveBeenCalled()
        },
    )
    it('does not audit an unchanged preset', async function () {
        const result = await updatePermissionPresetService(
            {
                id: presetId,
                name: 'Original preset',
                description: '',
                permissionKeys: [PERMISSIONS.USER_DASHBOARD],
            },
            ADMIN_ACTOR_ID,
        )
        expect(result).toMatchObject({ success: true, changed: false })
        expect(result).not.toHaveProperty('audit')
        expect(adminAuditDb.state.rows.auditLogs).toHaveLength(0)
    })
    it('rejects a duplicate preset name without changing permission rows', async function () {
        const before = structuredClone(adminAuditDb.state.rows)
        await expect(
            createPermissionPresetService(
                {
                    name: 'Original preset',
                    description: '',
                    permissionKeys: [],
                },
                ADMIN_ACTOR_ID,
            ),
        ).resolves.toMatchObject({ success: false })
        expect(adminAuditDb.state.rows).toEqual(before)
    })
    it.each(['create', 'update', 'delete'])(
        'retains %s and its audit when publishing fails',
        async function (operation) {
            adminAuditExternal.publishAudit.mockRejectedValueOnce(
                new Error('Audit topic unavailable'),
            )
            adminAuditExternal.publishPermissions.mockRejectedValueOnce(
                new Error('Permissions topic unavailable'),
            )
            await expect(mutate(operation)).resolves.toMatchObject({
                success: true,
            })
            expect(adminAuditDb.state.rows.auditLogs).toHaveLength(1)
            expect(adminAuditExternal.publishPermissions).toHaveBeenCalledTimes(
                1,
            )
        },
    )
})
