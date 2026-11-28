import { afterEach, describe, expect, it } from 'bun:test'
import path from 'node:path'
import { getAppStoreImagePaths } from '@/lib/Images/publicImagePaths.ts'

const previousPublic = process.env.APP_STORAGE_DIR
const fileId = '019f72d1-dc60-7040-bdac-9e201573f0aa'

afterEach(function () {
    if (previousPublic === undefined) delete process.env.APP_STORAGE_DIR
    else process.env.APP_STORAGE_DIR = previousPublic
})

describe('app store image paths', function () {
    it('places images in public storage below images/apps/<appId>', function () {
        process.env.APP_STORAGE_DIR = path.resolve('storage-root', 'public')
        const paths = getAppStoreImagePaths('rentner.weather-widget')

        expect(paths.absoluteDir).toBe(
            path.resolve(
                'storage-root',
                'public',
                'images',
                'apps',
                'rentner.weather-widget',
            ),
        )
        expect(paths.absoluteFile(fileId)).toBe(
            path.join(paths.absoluteDir, `${fileId}.webp`),
        )
        expect(paths.relativeFile(fileId)).toBe(
            `/images/apps/rentner.weather-widget/${fileId}.webp`,
        )
    })

    it.each([
        '../x',
        '..',
        'rentner.../x',
        'rentner/weather.app',
        'Rentner.App',
        'nodot',
        '.leading',
        'trailing.',
        'rentner.app\\x',
        '',
    ])('rejects the invalid app id %j', function (appId) {
        expect(() => getAppStoreImagePaths(appId)).toThrow(
            'Invalid app id for store image paths',
        )
    })

    it.each([
        '../../evil',
        'logo',
        '',
        '019F72D1-DC60-7040-BDAC-9E201573F0AA',
        `${fileId}.webp`,
        `${fileId}/../x`,
        '019f72d1-dc60-7040-bdac-9e201573f0a',
    ])('rejects the invalid file id %j', function (value) {
        const paths = getAppStoreImagePaths('rentner.weather-widget')

        expect(() => paths.absoluteFile(value)).toThrow(
            'Invalid store image file id',
        )
        expect(() => paths.relativeFile(value)).toThrow(
            'Invalid store image file id',
        )
    })
})
