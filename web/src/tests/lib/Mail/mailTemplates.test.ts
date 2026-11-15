import { describe, expect, it } from 'bun:test'
import { createAuthMailContent } from '@/lib/Mail/Templates/authMailTemplate.ts'
import { createFailedLoginAlertMailContent } from '@/lib/Mail/Templates/failedLoginAlertMailTemplate.ts'

describe('Mail-Templates', function () {
    it('escaped dynamische Werte in Auth-Mails', function () {
        const content = createAuthMailContent({
            headline: '<Passwort>',
            intro: 'Hallo <img src=x onerror=alert(1)>',
            resetLink: 'https://example.test/reset?token=a&next="unsafe"',
        })

        expect(content.html).not.toContain('<img src=x')
        expect(content.html).toContain('&lt;Passwort&gt;')
        expect(content.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(content.html).toContain('a&amp;next=&quot;unsafe&quot;')
        expect(content.html).toContain('background-color:#30ee61')
    })

    it('erzeugt für einen Lockout keinen Passwort-Link', function () {
        const content = createFailedLoginAlertMailContent({
            to: 'kevin@example.test',
            username: '<kevin>',
            ip: '203.0.113.10',
            location: null,
            device: 'Windows',
            browser: 'Chrome',
            attemptedAt: '11.07.2026, 10:30:00',
            mapsLink: null,
        })

        expect(content.html).toContain('Fehlgeschlagener Anmeldeversuch')
        expect(content.html).toContain('&lt;kevin&gt;')
        expect(content.html).not.toContain('Passwort setzen')
        expect(content.html).not.toContain('/password-reset')
    })

    it('escaped Anmeldedetails und Karten-Links ohne Klartextdetails zu verändern', function () {
        const detail = '<img src=x> & "quoted"'
        const mapsLink = 'https://example.test/maps?location=test&next="unsafe"'
        const content = createFailedLoginAlertMailContent({
            to: 'recipient@example.test',
            username: detail,
            ip: detail,
            location: detail,
            device: detail,
            browser: detail,
            attemptedAt: detail,
            mapsLink,
        })

        expect(content.html).not.toContain('<img')
        expect(content.html).toContain(
            '&lt;img src=x&gt; &amp; &quot;quoted&quot;',
        )
        expect(content.html).toContain(
            'href="https://example.test/maps?location=test&amp;next=&quot;unsafe&quot;"',
        )
        expect(content.text).toContain(detail)
        expect(content.text).toContain(mapsLink)
        expect(content.html).not.toContain('/password-reset')
    })
})
