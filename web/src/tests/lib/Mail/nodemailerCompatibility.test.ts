import { describe, expect, it } from 'bun:test'
import { createTransport } from 'nodemailer'

describe('Nodemailer mit eingebauten Typen', function () {
    it('erzeugt mit dem echten Transport eine Mail ausschließlich im Speicher', async function () {
        const transporter = createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix',
        })
        const result = await transporter.sendMail({
            from: { name: 'Test App', address: 'sender@example.test' },
            to: 'recipient@example.test',
            subject: 'Kompatibilität',
            text: 'Textinhalt',
            html: '<p>HTML-Inhalt</p>',
        })

        expect(result.envelope).toEqual({
            from: 'sender@example.test',
            to: ['recipient@example.test'],
        })
        expect(Buffer.isBuffer(result.message)).toBe(true)
        expect(result.message.toString()).toContain('multipart/alternative')
        expect(result.message.toString()).toContain('Textinhalt')
        expect(result.message.toString()).toContain('<p>HTML-Inhalt</p>')
    })
})
