import { describe, expect, it } from 'bun:test'
import { normalizeUserProfileUpdate } from '@/server/Admin/UserManagement/updateInput.service.ts'

function createInput() {
    return {
        accountType: 'public' as const,
        id: '019f72d1-dc60-7040-bdac-9e201573f094',
        username: '  kevin  ',
        email: '  KEVIN@example.test  ',
        firstName: '  Kevin  ',
        lastName: '  ',
        street: '',
        houseNumber: '  10  ',
        postalCode: ' 12345 ',
        city: ' Berlin ',
        permissionKeys: ['admin.userManagement'],
    }
}

describe('UserManagement Update-Normalisierung', function () {
    it('normalisiert Identität und optionale Profildaten', function () {
        expect(normalizeUserProfileUpdate(createInput())).toEqual({
            success: true,
            input: {
                accountType: 'public' as const,
                id: '019f72d1-dc60-7040-bdac-9e201573f094',
                username: 'kevin',
                email: 'kevin@example.test',
                profile: {
                    firstName: 'Kevin',
                    lastName: null,
                    street: null,
                    houseNumber: '10',
                    postalCode: '12345',
                    city: 'Berlin',
                },
            },
        })
    })

    it('lässt bei reinen Profildaten-Updates die Rechte unverändert', function () {
        const { permissionKeys: _permissionKeys, ...profileInput } =
            createInput()

        expect(normalizeUserProfileUpdate(profileInput)).toEqual({
            success: true,
            input: {
                accountType: 'public' as const,
                id: '019f72d1-dc60-7040-bdac-9e201573f094',
                username: 'kevin',
                email: 'kevin@example.test',
                profile: {
                    firstName: 'Kevin',
                    lastName: null,
                    street: null,
                    houseNumber: '10',
                    postalCode: '12345',
                    city: 'Berlin',
                },
            },
        })
    })

    it('behält den bestehenden Fehlervertrag für leere Pflichtfelder', function () {
        expect(
            normalizeUserProfileUpdate({
                ...createInput(),
                username: ' ',
            }),
        ).toEqual({
            success: false,
            error: 'Username und E-Mail sind erforderlich.',
        })
    })
})
