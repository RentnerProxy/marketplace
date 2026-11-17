import { faker } from '@faker-js/faker'
import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { inviteStaffInputSchema } from '@/features/Admin/StaffManagement/validation.ts'
import {
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '@/features/Admin/UserManagement/validation.ts'

function createValidUpdateUserInput() {
    return {
        id: Bun.randomUUIDv7(),
        accountType: 'public',
        username: faker.internet.username().slice(0, 50),
        email: faker.internet.email(),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        street: faker.location.street(),
        houseNumber: faker.location.buildingNumber(),
        postalCode: faker.location.zipCode(),
        city: faker.location.city(),
        permissionKeys: ['admin.dashboard', 'admin.userManagement'],
    }
}

describe('UserManagement Validierung', function () {
    it('normalizes a valid staff invitation', function () {
        const username = faker.internet.username().slice(0, 40)
        const email = faker.internet.email()

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
            username: faker.internet.username(),
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

    it('lehnt zu lange optionale Profildaten ab', function () {
        const result = updateUserProfileInputSchema.safeParse({
            ...createValidUpdateUserInput(),
            city: faker.string.alphanumeric(101),
        })

        expect(result.success).toBe(false)
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
