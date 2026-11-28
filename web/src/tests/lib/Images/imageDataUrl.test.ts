import sharp from 'sharp'
import { describe, expect, it } from 'bun:test'
import { getImageBufferFromDataUrl } from '@/lib/Images/imageDataUrl.ts'

describe('Bild-Upload-Validierung', function () {
    it('validiert Format und echte Abmessungen eines Bildes', async function () {
        const buffer = await sharp({
            create: {
                width: 4,
                height: 3,
                channels: 4,
                background: { r: 20, g: 40, b: 60, alpha: 1 },
            },
        })
            .png()
            .toBuffer()
        const base64 = buffer.toString('base64')
        const result = await getImageBufferFromDataUrl(
            `data:image/png;base64,${base64.slice(0, 24)}\n${base64.slice(24)}`,
            'Ungültiges Bild',
        )

        expect(result.width).toBe(4)
        expect(result.height).toBe(3)
        expect(result.buffer).toEqual(buffer)
    })

    it('akzeptiert keine beliebigen Data-URLs', async function () {
        await expect(
            getImageBufferFromDataUrl(
                `data:text/plain;base64,${Buffer.from('not-an-image').toString('base64')}`,
                'Ungültiges Bild',
            ),
        ).rejects.toThrow('Ungültiges Bild')
    })

    it.each([
        'data:image/png;base64,',
        'data:image/png;base64,???',
        'data:image/png\n;base64,AAAA',
        'data:image/png;BASE64,AAAA',
    ])('rejects malformed image data URLs: %s', async function (input) {
        await expect(
            getImageBufferFromDataUrl(input, 'Invalid image'),
        ).rejects.toThrow('Invalid image')
    })

    it('keeps the error for an unsupported image type', async function () {
        await expect(
            getImageBufferFromDataUrl('data:image/gif;base64,AAAA'),
        ).rejects.toThrow(
            'Erlaubt sind ausschließlich JPEG-, PNG- und WebP-Bilder.',
        )
    })
})
