import { describe, expect, it } from 'bun:test'
import { parsePublicStorageAssetPath } from '@/server/Request/storageAssetPath.service.ts'

describe('Public-Storage-Pfade', function () {
    it.each([
        '/favicon.ico',
        '/images/default.webp',
        '/images/system/logo-64.webp',
        '/images/user/019f5b07-80e2-7000-8000-000000000001/profile.webp',
    ])('akzeptiert den erwarteten öffentlichen Pfad %s', function (pathname) {
        expect(parsePublicStorageAssetPath(pathname)).toMatchObject({
            kind: 'storage',
        })
    })

    it('akzeptiert Store-Bilder unter /images/apps/<appId>/<uuid>.webp', function () {
        const pathname =
            '/images/apps/rentner.weather-widget/019f72d1-dc60-7040-bdac-9e201573f0aa.webp'

        expect(parsePublicStorageAssetPath(pathname)).toEqual({
            kind: 'storage',
            pathname,
            relativePath: pathname.slice(1),
        })
    })

    it.each([
        '/images/apps/rentner.app/../../../private/x.webp',
        '/images/apps/rentner.app/%2e%2e/019f72d1-dc60-7040-bdac-9e201573f0aa.webp',
        '/images/apps/rentner.app/019F72D1-DC60-7040-BDAC-9E201573F0AA.webp',
        '/images/apps/rentner.app/019f72d1-dc60-7040-bdac-9e201573f0aa.png',
        '/images/apps/rentner.app/019f72d1-dc60-7040-bdac-9e201573f0aa.webp/x',
        '/images/apps/rentnerapp/019f72d1-dc60-7040-bdac-9e201573f0aa.webp',
        '/images/apps/Rentner.app/019f72d1-dc60-7040-bdac-9e201573f0aa.webp',
        '/images/apps/rentner.app/logo.webp',
    ])('verwirft ungültige Store-Bildpfade %s', function (pathname) {
        expect(parsePublicStorageAssetPath(pathname).kind).not.toBe('storage')
    })

    it.each([
        '/images/user/019f5b07-80e2-7000-8000-000000000001/background.webp',
        '/images/user/x%2F..%2F..%2F..%2Fprivate%2Fimages%2Fuser%2Fvictim%2Fbackground.webp',
        '/images/user/id/%2e%2e/profile.webp',
        '/images/user/id\\..\\profile.webp',
    ])('verwirft private oder mehrdeutige Pfade %s', function (pathname) {
        expect(parsePublicStorageAssetPath(pathname).kind).not.toBe('storage')
    })
})
