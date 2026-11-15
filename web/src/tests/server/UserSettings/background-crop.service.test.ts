import { beforeEach, describe, expect, it, vi } from 'bun:test'
import sharp from 'sharp'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import {
    AUDIT_TEST_ACTOR,
    createAuditTransactionTestModel,
} from '@/tests/lib/AuditLogs/audit-transaction.test.helpers.ts'
import type { writePrivateStorageFileService } from '@/server/Storage/private-files.service.ts'

const model = createAuditTransactionTestModel()
model.install()
const writePrivateFile = vi.fn<typeof writePrivateStorageFileService>(
    async () => {},
)

vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentUserSettingsSession: async () => ({ id: AUDIT_TEST_ACTOR }),
}))
vi.mock('node:fs/promises', () => ({ rm: vi.fn(), lstat: vi.fn() }))
vi.mock('@/server/Storage/private-files.service.ts', () => ({
    writePrivateStorageFileService: writePrivateFile,
}))
vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
    getUserPublicImagePaths: () => ({
        absolutePrivateStorageRoot: 'C:/synthetic/private',
        absoluteBackground: 'C:/synthetic/private/background.webp',
        absoluteLegacyBackground: 'C:/synthetic/legacy/background.webp',
        relativeBackground: '/api/user/background',
    }),
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    withSharedStorageMutationBarrier: async <T>(operation: () => Promise<T>) =>
        operation(),
}))

const { updateCurrentUserBackgroundService } =
    await import('@/server/UserSettings/background.service.ts')
const cornerColors = [
    [240, 30, 30],
    [30, 220, 30],
    [30, 30, 240],
    [240, 220, 30],
] as const

describe('Hintergrund-Ausschnitt mit echter WebP-Kodierung', function () {
    beforeEach(function () {
        model.reset()
        writePrivateFile.mockClear()
    })

    it.each([
        { width: 408, height: 300 },
        { width: 700, height: 240 },
        { width: 240, height: 700 },
    ])(
        'erhält alle Ecken eines verschobenen Ausschnitts $width × $height',
        async function ({ width, height }) {
            const crop = { x: 30, y: 20, width, height }
            const imageWidth = width + 80
            const imageHeight = height + 60
            const pixels = Buffer.alloc(imageWidth * imageHeight * 3, 100)
            const patchWidth = Math.floor(width / 10)
            const patchHeight = Math.floor(height / 10)

            cornerColors.forEach(function (color, corner) {
                const left =
                    crop.x + (corner % 2 === 0 ? 0 : width - patchWidth)
                const top = crop.y + (corner < 2 ? 0 : height - patchHeight)

                for (let y = top; y < top + patchHeight; y += 1) {
                    for (let x = left; x < left + patchWidth; x += 1) {
                        const offset = (y * imageWidth + x) * 3
                        color.forEach((channel, index) => {
                            pixels[offset + index] = channel
                        })
                    }
                }
            })
            const input = await sharp(pixels, {
                raw: { width: imageWidth, height: imageHeight, channels: 3 },
            })
                .png()
                .toBuffer()

            await updateCurrentUserBackgroundService({
                imageDataUrl: `data:image/png;base64,${input.toString('base64')}`,
                crop,
                customBackgroundDarkness: 65,
            })

            expect(writePrivateFile).toHaveBeenCalledTimes(1)
            const encoded = writePrivateFile.mock.calls[0][0].data
            const metadata = await sharp(encoded).metadata()
            expect(metadata.format).toBe('webp')
            const { data, info } = await sharp(encoded)
                .removeAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true })

            expect(info.width).toBeLessThanOrEqual(
                IMAGE_UPLOAD_CONFIG.background.width,
            )
            expect(info.height).toBeLessThanOrEqual(
                IMAGE_UPLOAD_CONFIG.background.height,
            )
            expect(info.width / info.height).toBeCloseTo(width / height, 2)
            cornerColors.forEach(function (color, corner) {
                const x = Math.floor(
                    info.width * (corner % 2 === 0 ? 0.04 : 0.96),
                )
                const y = Math.floor(info.height * (corner < 2 ? 0.04 : 0.96))
                const offset = (y * info.width + x) * info.channels

                color.forEach(function (channel, index) {
                    expect(
                        Math.abs(data[offset + index] - channel),
                    ).toBeLessThan(12)
                })
            })
        },
    )
})
