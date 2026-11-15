import { describe, expect, it } from 'bun:test'
import { updateUserActiveStateInList } from '@/lib/UserManagement/userCache.ts'
import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'

function createUser(id: string, isActive: boolean): UserManagementUser {
    return {
        id,
        username: `user-${id}`,
        email: `${id}@example.com`,
        firstName: null,
        lastName: null,
        street: null,
        houseNumber: null,
        postalCode: null,
        city: null,
        isActive,
        createdByUserId: null,
        isDefaultUser: false,
        isSuperUser: false,
        isCurrentUser: false,
        createdAt: '2026-09-22T00:00:00.000Z',
        profileImageVersion: null,
        permissions: [],
    }
}

describe('UserManagement Query-Cache', function () {
    it('aktualisiert nur den Status des betroffenen Benutzers', function () {
        const firstUser = createUser('first', true)
        const secondUser = createUser('second', false)

        const result = updateUserActiveStateInList(
            [firstUser, secondUser],
            secondUser.id,
            true,
        )

        expect(result).toEqual([firstUser, { ...secondUser, isActive: true }])
        expect(result?.[0]).toBe(firstUser)
    })

    it('behält die Referenz ohne passende Änderung bei', function () {
        const users = [createUser('first', true)]

        expect(updateUserActiveStateInList(users, 'missing', false)).toBe(users)
        expect(updateUserActiveStateInList(users, 'first', true)).toBe(users)
        expect(updateUserActiveStateInList(undefined, 'first', false)).toBe(
            undefined,
        )
    })
})
