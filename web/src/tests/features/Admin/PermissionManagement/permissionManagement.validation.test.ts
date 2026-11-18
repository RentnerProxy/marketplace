import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    createPermissionPresetInputSchema,
    deletePermissionPresetInputSchema,
    replaceManagedUserPermissionsInputSchema,
    updatePermissionPresetInputSchema,
} from '@/features/Admin/PermissionManagement/validation.ts'

const presetId = '01941f29-7c00-7000-8000-000000000001'
const userId = '01941f29-7c00-7000-8000-000000000002'

describe('PermissionManagement Validierung', function () {
    it('normalisiert gültige Preset- und User-Rechte-Eingaben', function () {
        expect(
            createPermissionPresetInputSchema.parse({
                name: ' Standardbenutzer ',
                description: ' Grundlegende Benutzerrechte ',
                permissionKeys: [` ${PERMISSIONS.USER_DASHBOARD} `],
            }),
        ).toEqual({
            name: 'Standardbenutzer',
            description: 'Grundlegende Benutzerrechte',
            permissionKeys: [PERMISSIONS.USER_DASHBOARD],
        })

        expect(
            updatePermissionPresetInputSchema.parse({
                id: presetId,
                name: ' Administration ',
                description: ' Administrationsrechte ',
                permissionKeys: [` ${PERMISSIONS.ADMIN_DASHBOARD} `],
            }),
        ).toEqual({
            id: presetId,
            name: 'Administration',
            description: 'Administrationsrechte',
            permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
        })

        expect(
            deletePermissionPresetInputSchema.parse({ id: presetId }),
        ).toEqual({ id: presetId })

        expect(
            replaceManagedUserPermissionsInputSchema.parse({
                userId,
                permissionKeys: [` ${PERMISSIONS.ADMIN_DASHBOARD} `],
            }),
        ).toEqual({
            userId,
            permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
        })
    })

    it('lehnt unbekannte und doppelte Permission-Keys ab', function () {
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'Preset',
                description: '',
                permissionKeys: [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.USER_DASHBOARD,
                ],
            }).success,
        ).toBe(false)
        expect(
            replaceManagedUserPermissionsInputSchema.safeParse({
                userId,
                permissionKeys: ['admin.unbekannt'],
            }).success,
        ).toBe(false)
        expect(
            replaceManagedUserPermissionsInputSchema.safeParse({
                userId,
                permissionKeys: [
                    PERMISSIONS.ADMIN_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                ],
            }).success,
        ).toBe(false)
    })

    it('verbietet automatische Superuser-Rechte und erlaubt sie bei einzelnen Benutzern', function () {
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'Superuser',
                description: '',
                permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
            }).success,
        ).toBe(false)
        expect(
            updatePermissionPresetInputSchema.safeParse({
                id: presetId,
                name: 'Superuser',
                description: '',
                permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
            }).success,
        ).toBe(false)
        expect(
            replaceManagedUserPermissionsInputSchema.parse({
                userId,
                permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
            }),
        ).toEqual({
            userId,
            permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
        })
    })

    it('validiert Preset-IDs sowie Name- und Description-Grenzen', function () {
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'ab',
                description: 'a'.repeat(500),
                permissionKeys: [],
            }).success,
        ).toBe(true)
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'a'.repeat(100),
                description: '',
                permissionKeys: [],
            }).success,
        ).toBe(true)
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'a',
                description: '',
                permissionKeys: [],
            }).success,
        ).toBe(false)
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'a'.repeat(101),
                description: '',
                permissionKeys: [],
            }).success,
        ).toBe(false)
        expect(
            createPermissionPresetInputSchema.safeParse({
                name: 'Preset',
                description: 'a'.repeat(501),
                permissionKeys: [],
            }).success,
        ).toBe(false)
        expect(
            updatePermissionPresetInputSchema.safeParse({
                id: 'keine-uuid',
                name: 'Preset',
                description: '',
                permissionKeys: [],
            }).success,
        ).toBe(false)
        expect(
            deletePermissionPresetInputSchema.safeParse({
                id: 'keine-uuid',
            }).success,
        ).toBe(false)
        expect(
            replaceManagedUserPermissionsInputSchema.safeParse({
                userId: 'keine-uuid',
                permissionKeys: [],
            }).success,
        ).toBe(false)
    })
})
