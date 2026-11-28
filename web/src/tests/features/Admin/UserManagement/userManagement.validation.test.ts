import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { inviteStaffInputSchema } from '@/features/Admin/StaffManagement/validation.ts'
import {
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '@/features/Admin/UserManagement/validation.ts'

const username = 'fixture-user'
const email = 'Fixture@Example.test'

function createValidUpdateUserInput() {
    return {
        id: '01941f29-7c00-7000-8000-000000000001',
        accountType: 'public',
        username,
        email,
        permissionKeys: ['admin.dashboard', 'admin.userManagement'],
    }
}

describe('UserManagement Validierung', function () {
    it('normalizes a valid staff invitation', function () {
        const result = inviteStaffInputSchema.safeParse({
            permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
            username: ` ${username} `,
            email: ` ${email} `,
        })

        expect(result.success).toBe(true)

        if (result.success) {
            expect(result.data.username).toBe(username)
            expect(result.data.email).toBe(email.toLowerCase())
        }
    })

    it('rejects invalid staff invitation addresses', function () {
        const result = inviteStaffInputSchema.safeParse({
            permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
            username,
            email: 'keine-email',
        })

        expect(result.success).toBe(false)
    })

    it('akzeptiert gültige Update-User-Daten für das Profil', function () {
        const result = updateUserProfileInputSchema.safeParse(
            createValidUpdateUserInput(),
        )

        expect(result.success).toBe(true)
    })

    it('akzeptiert reine Profildaten ohne Rechte-Payload', function () {
        const { permissionKeys: _permissionKeys, ...profileInput } =
            createValidUpdateUserInput()

        expect(
            updateUserProfileInputSchema.safeParse(profileInput).success,
        ).toBe(true)
    })

    it('lehnt ungültige User-IDs für Admin-Aktionen ab', function () {
        expect(
            deleteUserInputSchema.safeParse({
                id: 'ungueltig',
                accountType: 'public',
            }).success,
        ).toBe(false)
        expect(
            resetUserPasswordInputSchema.safeParse({
                id: 'ungueltig',
                accountType: 'staff',
            }).success,
        ).toBe(false)
        expect(
            setUserActiveInputSchema.safeParse({
                id: 'ungueltig',
                accountType: 'staff',
                isActive: true,
            }).success,
        ).toBe(false)
    })
})
