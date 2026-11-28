import { describe, expect, it } from 'bun:test'
import { normalizeUserProfileUpdate } from '@/server/Admin/UserManagement/updateInput.service.ts'

function createInput() {
    return {
        accountType: 'public' as const,
        id: '019f72d1-dc60-7040-bdac-9e201573f094',
        username: '  kevin  ',
        email: '  KEVIN@example.test  ',
        permissionKeys: ['admin.userManagement'],
    }
}

describe('UserManagement Update-Normalisierung', function () {
    it('normalisiert die Kontoidentität', function () {
        expect(normalizeUserProfileUpdate(createInput())).toEqual({
            success: true,
            input: {
                accountType: 'public' as const,
                id: '019f72d1-dc60-7040-bdac-9e201573f094',
                username: 'kevin',
                email: 'kevin@example.test',
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
