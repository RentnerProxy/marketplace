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
        const result = await getImageBufferFromDataUrl(
            `data:image/png;base64,${buffer.toString('base64')}`,
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
})
