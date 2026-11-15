import { afterEach, describe, expect, it } from 'bun:test'
import path from 'node:path'
import { createIcoFromPngBuffer } from '@/lib/Images/ico.ts'
import {
    getPrivateStorageRoot,
    getPublicStorageRoot,
    getSystemLogoPublicImagePaths,
    getUserPublicImagePaths,
} from '@/lib/Images/publicImagePaths.ts'

const previousPublic = process.env.APP_STORAGE_DIR
const previousPrivate = process.env.APP_PRIVATE_STORAGE_DIR
afterEach(function () {
    if (previousPublic === undefined) delete process.env.APP_STORAGE_DIR
    else process.env.APP_STORAGE_DIR = previousPublic
    if (previousPrivate === undefined)
        delete process.env.APP_PRIVATE_STORAGE_DIR
    else process.env.APP_PRIVATE_STORAGE_DIR = previousPrivate
})

describe('image storage and favicon artifacts', function () {
    it('encapsulates the supplied PNG bytes in a readable single-image 32-bit ICO directory', function () {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
        const original = Buffer.from(png)
        const icon = createIcoFromPngBuffer(png)
        expect(icon.readUInt16LE(0)).toBe(0)
        expect(icon.readUInt16LE(2)).toBe(1)
        expect(icon.readUInt16LE(4)).toBe(1)
        expect([icon[6], icon[7]]).toEqual([32, 32])
        expect(icon.readUInt16LE(12)).toBe(32)
        const offset = icon.readUInt32LE(18)
        const size = icon.readUInt32LE(14)
        expect(size).toBe(png.length)
        expect(icon.length).toBe(offset + size)
        expect(icon.subarray(offset, offset + size)).toEqual(png)
        expect(png).toEqual(original)
    })

    it('defaults public assets to web/public/ and authenticated backgrounds to private storage', function () {
        delete process.env.APP_STORAGE_DIR
        delete process.env.APP_PRIVATE_STORAGE_DIR
        expect(getPublicStorageRoot()).toBe(
            path.join(process.cwd(), 'web', 'public'),
        )
        expect(getPrivateStorageRoot()).toBe(
            path.join(process.cwd(), 'storage-data', 'private'),
        )
        const images = getUserPublicImagePaths('member-1')
        expect(images.relativeProfile).toBe(
            '/images/user/member-1/profile.webp',
        )
        expect(images.relativeProfileSmall).toBe(
            '/images/user/member-1/profile-64.webp',
        )
        expect(images.relativeBackground).toBe('/api/user/background')
        expect(images.absoluteBackground).toBe(
            path.join(
                getPrivateStorageRoot(),
                'images',
                'user',
                'member-1',
                'background.webp',
            ),
        )
        expect(images.absoluteLegacyBackground).toBe(
            path.join(images.absoluteDir, 'background.webp'),
        )
        expect(images.absoluteProfile).toBe(
            path.join(images.absoluteDir, 'profile.webp'),
        )
    })

    it('resolves configured roots and derives a private sibling without exposing it through image URLs', function () {
        process.env.APP_STORAGE_DIR = './.tools/image-fixture/public'
        delete process.env.APP_PRIVATE_STORAGE_DIR
        expect(getPrivateStorageRoot()).toBe(
            path.join(
                path.dirname(path.resolve(process.env.APP_STORAGE_DIR)),
                'private',
            ),
        )
        process.env.APP_PRIVATE_STORAGE_DIR = './.tools/image-fixture/protected'
        expect(getPrivateStorageRoot()).toBe(
            path.resolve(process.env.APP_PRIVATE_STORAGE_DIR),
        )
        const logo = getSystemLogoPublicImagePaths()
        expect(logo.relativeLarge).toBe('/images/system/logo.webp')
        expect(logo.relativeSmall).toBe('/images/system/logo-64.webp')
        expect(logo.relativeFavicon).toBe('/favicon.ico')
        expect(logo.absoluteLarge).toBe(
            path.join(getPublicStorageRoot(), 'images', 'system', 'logo.webp'),
        )
        expect(logo.absoluteSmall).toBe(
            path.join(logo.absoluteDir, 'logo-64.webp'),
        )
        expect(logo.absoluteFavicon).toBe(
            path.join(getPublicStorageRoot(), 'favicon.ico'),
        )
    })
})
