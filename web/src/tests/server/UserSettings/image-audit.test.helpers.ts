import { vi } from 'bun:test'
import type { createAuditTransactionTestModel } from '@/tests/lib/AuditLogs/audit-transaction.test.helpers.ts'
import type { writePrivateStorageFileService } from '@/server/Storage/private-files.service.ts'

export function installUserSettingsImageTestMocks(
    model: ReturnType<typeof createAuditTransactionTestModel>,
) {
    const paths = {
        absoluteDir: 'C:/synthetic/profile',
        absoluteProfile: 'C:/synthetic/profile/full.webp',
        absoluteProfileSmall: 'C:/synthetic/profile/small.webp',
        relativeProfile: '/images/profile.webp',
        relativeProfileSmall: '/images/profile-small.webp',
        absolutePrivateStorageRoot: 'C:/synthetic/private',
        absoluteBackgroundDir: 'C:/synthetic/private/images/user',
        absoluteBackground: 'C:/synthetic/private/images/user/background.webp',
        absoluteLegacyBackground: 'C:/synthetic/legacy-background.webp',
        relativeBackground: '/api/images/background',
    }
    const getPaths = vi.fn((_userId: string) => paths)
    const encodedImage = Buffer.from('synthetic-encoded-webp')
    const toBuffer = vi.fn(async function () {
        model.state.events.push('image:encode')
        return encodedImage
    })
    const writePrivateFile = vi.fn<typeof writePrivateStorageFileService>(
        async function (_options) {
            model.state.events.push('fs:write-private')
        },
    )
    const mkdir = vi.fn(async function (_path: string, _options: unknown) {
        model.state.events.push('fs:mkdir')
    })
    const lstat = vi.fn(async function (_path: string): Promise<object> {
        return {}
    })
    const rm = vi.fn(async function (_path: string, _options: unknown) {
        model.state.events.push('fs:rm')
    })
    const toFile = vi.fn(async function (_path: string) {
        model.state.events.push('fs:write')
    })
    const writeFile = vi.fn(async function (_data: Buffer) {
        model.state.events.push('fs:write')
    })
    const close = vi.fn(async function () {
        model.state.events.push('fs:close')
    })
    const open = vi.fn(async function (_path: string, _flags: string) {
        return { writeFile, close }
    })
    const rename = vi.fn(async function (_source: string, _target: string) {
        model.state.events.push('fs:rename')
    })
    const rawPixels = Buffer.from('synthetic raw pixels')
    const decodePixels = vi.fn(async function () {
        model.state.events.push('image:decode')
        return {
            data: rawPixels,
            info: { width: 512, height: 512, channels: 4 },
        }
    })
    const extract = vi.fn()
    const resize = vi.fn()
    const toColorspace = vi.fn()
    const webp = vi.fn()
    const sharp = vi.fn(function () {
        const chain = {
            extract,
            resize,
            toColorspace,
            webp,
            raw: () => ({ toBuffer: decodePixels }),
            toFile,
            toBuffer,
        }
        chain.extract.mockReturnValue(chain)
        chain.resize.mockReturnValue(chain)
        chain.toColorspace.mockReturnValue(chain)
        chain.webp.mockReturnValue(chain)
        return chain
    })
    const getBuffer = vi.fn(async () => ({
        buffer: Buffer.from('image'),
        width: 100,
        height: 100,
    }))
    vi.mock('node:fs/promises', () => ({ mkdir, rm, lstat, open, rename }))
    vi.mock('sharp', () => ({ default: sharp }))
    vi.mock('@/server/Storage/private-files.service.ts', () => ({
        writePrivateStorageFileService: writePrivateFile,
    }))
    vi.mock('@/lib/Images/imageDataUrl.ts', () => ({
        getImageBufferFromDataUrl: getBuffer,
        getSafeImageCrop: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    }))
    vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
        getUserPublicImagePaths: getPaths,
    }))
    vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
        withSharedStorageMutationBarrier: async <T>(
            operation: () => Promise<T>,
        ) => operation(),
    }))
    return {
        paths,
        getPaths,
        encodedImage,
        mkdir,
        rm,
        lstat,
        toFile,
        toBuffer,
        decodePixels,
        rawPixels,
        writeFile,
        open,
        rename,
        writePrivateFile,
        sharp,
        extract,
        resize,
        toColorspace,
        webp,
        getBuffer,
    }
}
