import { describe, expect, it } from 'bun:test'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'

describe('Data-URL-Dateigröße', function () {
    it('berücksichtigt Base64-Padding und fehlende Nutzdaten', function () {
        expect(getDataUrlByteSize('data:text/plain;base64,SGVsbG8=')).toBe(5)
        expect(getDataUrlByteSize('data:text/plain;base64,QQ==')).toBe(1)
        expect(getDataUrlByteSize('ohne-komma')).toBe(0)
    })
})
