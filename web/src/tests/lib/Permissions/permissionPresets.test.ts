import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getAppliedPermissionPresets,
    getPresetPermissionKeys,
} from '@/lib/Permissions/permissionPresets.ts'
import type { PermissionPreset } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

function createPreset(
    id: string,
    permissionKeys: Array<string>,
): PermissionPreset {
    return {
        id,
        name: id,
        description: '',
        permissionKeys,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    }
}

describe('Permission-Preset-Helfer', function () {
    it('erkennt vollständig angewendete Presets', function () {
        const appliedPreset = createPreset('angewendet', [
            PERMISSIONS.USER_DASHBOARD,
            PERMISSIONS.ADMIN_DASHBOARD,
        ])
        const partialPreset = createPreset('teilweise', [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        ])
        const superUserOnlyPreset = createPreset('superuser', [
            PERMISSIONS.ADMIN_SUPER_USER,
        ])

        expect(
            getAppliedPermissionPresets(
                [appliedPreset, partialPreset, superUserOnlyPreset],
                [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                ],
            ),
        ).toEqual([appliedPreset])
    })

    it('führt die Rechte mehrerer Presets ohne Duplikate zusammen', function () {
        expect(
            getPresetPermissionKeys([
                createPreset('eins', [PERMISSIONS.USER_DASHBOARD]),
                createPreset('zwei', [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                    PERMISSIONS.ADMIN_SUPER_USER,
                ]),
            ]),
        ).toEqual([PERMISSIONS.USER_DASHBOARD, PERMISSIONS.ADMIN_DASHBOARD])
    })
})
