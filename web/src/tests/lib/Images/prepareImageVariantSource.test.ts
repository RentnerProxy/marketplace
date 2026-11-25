import { expect, it } from 'bun:test'
import sharp from 'sharp'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { createIcoFromPngBuffer } from '@/lib/Images/ico.ts'
import { prepareImageVariantSource } from '@/lib/Images/prepareImageVariantSource.ts'

it('uses three sRGB channels for variants decoded from a CMYK JPEG', async function () {
    const input = await sharp({
        create: { width: 16, height: 16, channels: 3, background: '#ec365a' },
    })
        .toColorspace('cmyk')
        .jpeg()
        .toBuffer()
    expect((await sharp(input).metadata()).space).toBe('cmyk')

    const createVariant = await prepareImageVariantSource(
        input,
        { left: 0, top: 0, width: 16, height: 16 },
        8,
        8,
    )
    const { data, info } = await createVariant()
        .raw()
        .toBuffer({ resolveWithObject: true })
    const expected = await sharp(input)
        .resize(8, 8)
        .toColorspace('srgb')
        .raw()
        .toBuffer()

    expect(info).toMatchObject({ width: 8, height: 8, channels: 3 })
    expect(data.equals(expected)).toBe(true)
})

it('preserves the shifted cover crop and alpha in WebP and PNG favicon variants', async function () {
    const width = 120
    const height = 90
    const channels = 4
    const pixels = Buffer.alloc(width * height * channels)
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * channels
            const inCoverCrop = x >= 35 && x < 85 && y >= 20 && y < 70
            pixels[offset] = inCoverCrop ? 20 : 240
            pixels[offset + 1] = inCoverCrop ? 170 : 40
            pixels[offset + 2] = 30
            pixels[offset + 3] = inCoverCrop ? 128 : 255
        }
    }
    const input = await sharp(pixels, { raw: { width, height, channels } })
        .png()
        .toBuffer()
    const config = IMAGE_UPLOAD_CONFIG.systemLogo
    const createVariant = await prepareImageVariantSource(
        input,
        { left: 15, top: 20, width: 90, height: 50 },
        config.width,
        config.height,
    )

    const [large, small, favicon] = await Promise.all([
        createVariant().webp({ quality: config.quality }).toBuffer(),
        createVariant()
            .resize(config.thumbnailWidth, config.thumbnailHeight)
            .webp({ quality: config.thumbnailQuality })
            .toBuffer(),
        createVariant().resize(32, 32).png().toBuffer(),
    ])
    const ico = createIcoFromPngBuffer(favicon)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(1)
    expect(ico.readUInt32LE(14)).toBe(favicon.byteLength)
    const embeddedPng = ico.subarray(ico.readUInt32LE(18))

    const variants = [
        [large, 'webp', 512],
        [small, 'webp', 64],
        [embeddedPng, 'png', 32],
    ] as const
    await Promise.all(
        variants.map(async function ([image, format, size]) {
            const decoded = sharp(image)
            const [metadata, { data, info }] = await Promise.all([
                decoded.metadata(),
                decoded.raw().toBuffer({ resolveWithObject: true }),
            ])
            expect(metadata).toMatchObject({
                format,
                width: size,
                height: size,
            })
            expect(info.channels).toBe(4)
            const inset = Math.floor(size / 8)
            for (const x of [inset, size - inset - 1]) {
                for (const y of [inset, size - inset - 1]) {
                    const offset = (y * size + x) * info.channels
                    expect(data[offset]).toBeLessThan(35)
                    expect(data[offset + 1]).toBeGreaterThan(155)
                    expect(data[offset + 3]).toBe(128)
                }
            }
        }),
    )
})
