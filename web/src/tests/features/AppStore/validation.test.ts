import { describe, expect, it } from 'bun:test'
import {
    reorderStoreScreenshotsInputSchema,
    storeAppInputSchema,
    storeScreenshotInputSchema,
    updateStoreDescriptionInputSchema,
    uploadStoreImageInputSchema,
} from '@/features/AppStore/validation.ts'

const appId = 'rentner.weather-widget'
const shotA = '019f72d1-dc60-7040-bdac-9e201573f0a1'
const shotB = '019f72d1-dc60-7040-bdac-9e201573f0a2'
const crop = { x: 0, y: 0, width: 10, height: 10 }

function parse(screenshotIds: Array<string>) {
    return reorderStoreScreenshotsInputSchema.safeParse({
        appId,
        screenshotIds,
    }).success
}

describe('store description validation', () => {
    it('normalises line endings and trims the text', () => {
        expect(
            updateStoreDescriptionInputSchema.parse({
                appId,
                description: '  eins\r\nzwei\rdrei\n  ',
            }).description,
        ).toBe('eins\nzwei\ndrei')
    })

    it('turns whitespace-only text into an empty string', () => {
        expect(
            updateStoreDescriptionInputSchema.parse({
                appId,
                description: ' \r\n ',
            }).description,
        ).toBe('')
    })

    it('accepts exactly 5000 characters and rejects more', () => {
        expect(
            updateStoreDescriptionInputSchema.safeParse({
                appId,
                description: 'a'.repeat(5000),
            }).success,
        ).toBe(true)
        expect(
            updateStoreDescriptionInputSchema.safeParse({
                appId,
                description: 'a'.repeat(5001),
            }).success,
        ).toBe(false)
    })
})

describe('store input validation', () => {
    it.each(['../x', 'Rentner.App', 'noDot', 'rentner.', ''])(
        'rejects the app id %j',
        (value) => {
            expect(
                storeAppInputSchema.safeParse({ appId: value }).success,
            ).toBe(false)
        },
    )

    it('accepts valid image uploads only', () => {
        const imageDataUrl = 'data:image/png;base64,AAAA'
        expect(
            uploadStoreImageInputSchema.safeParse({ appId, imageDataUrl, crop })
                .success,
        ).toBe(true)
        expect(
            uploadStoreImageInputSchema.safeParse({
                appId,
                imageDataUrl: 'data:image/gif;base64,AAAA',
                crop,
            }).success,
        ).toBe(false)
        expect(
            uploadStoreImageInputSchema.safeParse({
                appId,
                imageDataUrl,
                crop: { ...crop, width: 0 },
            }).success,
        ).toBe(false)
    })

    it('requires a UUIDv7 screenshot id', () => {
        expect(
            storeScreenshotInputSchema.safeParse({ appId, screenshotId: shotA })
                .success,
        ).toBe(true)
        expect(
            storeScreenshotInputSchema.safeParse({
                appId,
                screenshotId: 'not-a-uuid',
            }).success,
        ).toBe(false)
    })

    it('limits reorder requests to 1-8 unique screenshot ids', () => {
        const ids = Array.from(
            { length: 9 },
            (_, index) => `019f72d1-dc60-7040-bdac-9e201573f0b${index}`,
        )
        expect(parse([shotA, shotB])).toBe(true)
        expect(parse(ids.slice(0, 8))).toBe(true)
        expect(parse(ids)).toBe(false)
        expect(parse([])).toBe(false)
        expect(parse([shotA, shotA])).toBe(false)
    })
})
