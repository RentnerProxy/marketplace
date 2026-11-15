import { describe, expect, it } from 'bun:test'
import { getSetupAccessTokenFromFragment } from '@/features/Auth/FirstSuperUser/setupAccess.ts'

describe('First-Superuser-Setup-Link', function () {
    it('liest ausschließlich einen exakt formatierten Fragment-Token', function () {
        const token = 'A'.repeat(43)

        expect(getSetupAccessTokenFromFragment(`#access=${token}`)).toBe(token)
        expect(getSetupAccessTokenFromFragment(`?access=${token}`)).toBeNull()
        expect(
            getSetupAccessTokenFromFragment(`#access=${token}&extra=value`),
        ).toBeNull()
        expect(getSetupAccessTokenFromFragment('#access=short')).toBeNull()
    })
})
