import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import {
    encodeStoreImageService,
    getStoreImageSrc,
    removeStoreImageFilesService,
    writeStoreImageFileService,
} from '@/server/AppStore/images.service.ts'

const appId = 'rentner.weather-widget'
const fileId = '019f72d1-dc60-7040-bdac-9e201573f0aa'
const otherFileId = '019f72d1-dc60-7040-bdac-9e201573f0bb'
const originalStorageDir = process.env.APP_STORAGE_DIR
let storageDir = ''

async function createDataUrl(
    format: 'png' | 'jpeg',
    width: number,
    height: number,
    mime: string = `image/${format}`,
) {
    const background = { r: 200, g: 40, b: 20 }
    const image = sharp({
        create: { width, height, channels: 3, background },
    })
    const buffer = await (
        format === 'png' ? image.png() : image.jpeg()
    ).toBuffer()
    return `data:${mime};base64,${buffer.toString('base64')}`
}

async function exists(file: string) {
    return access(file).then(
        () => true,
        () => false,
    )
}

beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'app-store-images-'))
    process.env.APP_STORAGE_DIR = storageDir
})

afterEach(async () => {
    if (originalStorageDir === undefined) delete process.env.APP_STORAGE_DIR
    else process.env.APP_STORAGE_DIR = originalStorageDir
    await rm(storageDir, { recursive: true, force: true })
})

describe('store image encoding', () => {
    it('crops a PNG logo to a 512x512 WebP', async () => {
        const encoded = await encodeStoreImageService(
            await createDataUrl('png', 800, 600),
            { x: 100, y: 50, width: 400, height: 400 },
            'logo',
        )
        const metadata = await sharp(encoded ?? Buffer.alloc(0)).metadata()
        expect(metadata).toMatchObject({
            format: 'webp',
            width: 512,
            height: 512,
        })
    })

    it('crops a JPEG screenshot to a 1920x1080 WebP', async () => {
        const encoded = await encodeStoreImageService(
            await createDataUrl('jpeg', 1280, 720),
            { x: 0, y: 0, width: 1280, height: 720 },
            'screenshot',
        )
        const metadata = await sharp(encoded ?? Buffer.alloc(0)).metadata()
        expect(metadata).toMatchObject({
            format: 'webp',
            width: 1920,
            height: 1080,
        })
    })

    it('rejects a declared MIME type that does not match the bytes', async () => {
        await expect(
            encodeStoreImageService(
                await createDataUrl('png', 100, 100, 'image/jpeg'),
                { x: 0, y: 0, width: 100, height: 100 },
                'logo',
            ),
        ).resolves.toBeNull()
    })

    it('rejects crops outside of the image', async () => {
        await expect(
            encodeStoreImageService(
                await createDataUrl('png', 100, 100),
                { x: 50, y: 0, width: 100, height: 100 },
                'logo',
            ),
        ).resolves.toBeNull()
    })

    it('rejects unsupported and malformed data URLs', async () => {
        const crop = { x: 0, y: 0, width: 1, height: 1 }
        const values = [
            'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            'data:image/png;base64,bm90IGFuIGltYWdl',
            'not a data url',
        ]
        const results = await Promise.all(
            values.map((value) => encodeStoreImageService(value, crop, 'logo')),
        )
        expect(results).toEqual([null, null, null])
    })
})

describe('store image files', () => {
    it('writes files below images/apps/<appId> and returns the public path', async () => {
        const src = await writeStoreImageFileService(
            appId,
            fileId,
            Buffer.from('webp-bytes'),
        )
        const file = path.join(
            storageDir,
            'images',
            'apps',
            appId,
            `${fileId}.webp`,
        )

        expect(src).toBe(`/images/apps/${appId}/${fileId}.webp`)
        expect((await readFile(file)).toString()).toBe('webp-bytes')
    })

    it('leaves no temporary files behind', async () => {
        await writeStoreImageFileService(appId, fileId, Buffer.from('a'))
        expect(
            await readdir(path.join(storageDir, 'images', 'apps', appId)),
        ).toEqual([`${fileId}.webp`])
    })

    it('removes only the requested files and tolerates missing ones', async () => {
        await writeStoreImageFileService(appId, fileId, Buffer.from('a'))
        await writeStoreImageFileService(appId, otherFileId, Buffer.from('b'))
        const dir = path.join(storageDir, 'images', 'apps', appId)

        await removeStoreImageFilesService(appId, [
            fileId,
            '019f72d1-dc60-7040-bdac-9e201573f0cc',
        ])

        expect(await exists(path.join(dir, `${fileId}.webp`))).toBe(false)
        expect(await exists(path.join(dir, `${otherFileId}.webp`))).toBe(true)
    })

    it('rejects invalid app and file ids before touching the disk', async () => {
        await expect(
            writeStoreImageFileService('../x', fileId, Buffer.from('a')),
        ).rejects.toThrow()
        await expect(
            writeStoreImageFileService(appId, '../../evil', Buffer.from('a')),
        ).rejects.toThrow()
        expect(await exists(path.join(storageDir, 'images'))).toBe(false)
    })
})

describe('store image sources', () => {
    it('maps file ids to public paths and null to null', () => {
        expect(getStoreImageSrc(appId, fileId)).toBe(
            `/images/apps/${appId}/${fileId}.webp`,
        )
        expect(getStoreImageSrc(appId, null)).toBeNull()
    })
})
