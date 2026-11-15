import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    permissionKeySchema,
    permissionKeysSchema,
} from '@/lib/Permissions/permissionSchemas.ts'

describe('Permission-Schemas', function () {
    it('normalisiert bekannte Permission-Keys', function () {
        expect(
            permissionKeySchema.parse(` ${PERMISSIONS.ADMIN_DASHBOARD} `),
        ).toBe(PERMISSIONS.ADMIN_DASHBOARD)
    })

    it('lehnt unbekannte und doppelte Permission-Keys ab', function () {
        expect(permissionKeySchema.safeParse('admin.unbekannt').success).toBe(
            false,
        )
        expect(
            permissionKeysSchema.safeParse([
                PERMISSIONS.ADMIN_DASHBOARD,
                PERMISSIONS.ADMIN_DASHBOARD,
            ]).success,
        ).toBe(false)
    })
})
