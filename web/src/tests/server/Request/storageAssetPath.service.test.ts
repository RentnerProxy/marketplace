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

    it.each([
        '/images/user/019f5b07-80e2-7000-8000-000000000001/background.webp',
        '/images/user/x%2F..%2F..%2F..%2Fprivate%2Fimages%2Fuser%2Fvictim%2Fbackground.webp',
        '/images/user/id/%2e%2e/profile.webp',
        '/images/user/id\\..\\profile.webp',
    ])('verwirft private oder mehrdeutige Pfade %s', function (pathname) {
        expect(parsePublicStorageAssetPath(pathname).kind).not.toBe('storage')
    })
})
