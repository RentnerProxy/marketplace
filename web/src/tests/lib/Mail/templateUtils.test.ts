import { describe, expect, it } from 'bun:test'
import { joinMailHtml, mailHtml } from '@/lib/Mail/Templates/templateUtils.ts'

describe('Sichere Mail-HTML-Fragmente', function () {
    it('escaped Text und Attribute automatisch und genau einmal', function () {
        const value = '<img src=x onerror=alert(1)> & "quoted" \'single\''
        const fragment = mailHtml`<p title="${value}">${value}</p>`
        const escaped =
            '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &#039;single&#039;'

        expect(fragment.html).toBe(
            '<p title="' + escaped + '">' + escaped + '</p>',
        )
        expect(fragment.html).not.toContain('<img')
        expect(fragment.html).not.toContain('&amp;lt;')
    })

    it('behält verschachtelte sichere Fragmente und numerische Werte bei', function () {
        const fragment = mailHtml`<p>${'<unsafe>'}</p>`
        const html =
            mailHtml`<section style="font-size:${16}px">${fragment}</section>`
                .html

        expect(html).toBe(
            '<section style="font-size:16px"><p>&lt;unsafe&gt;</p></section>',
        )
    })

    it('verbindet Fragmente in ihrer Reihenfolge ohne doppeltes Escaping', function () {
        const rows = joinMailHtml([
            mailHtml`<p>${'A & B'}</p>`,
            mailHtml`<p>${'<C>'}</p>`,
        ])

        expect(mailHtml`<div>${rows}</div>`.html).toBe(
            '<div><p>A &amp; B</p><p>&lt;C&gt;</p></div>',
        )
        expect(joinMailHtml([]).html).toBe('')
    })

    it('weist nachgeahmte und kopierte HTML-Fragmente zurück', function () {
        const forged = { html: '<img src=x onerror=alert(1)>' }
        const copied = { ...mailHtml`<p>safe</p>` }

        for (const fragment of [forged, copied]) {
            expect(() => mailHtml`<div>${fragment}</div>`).toThrow(
                'Untrusted mail HTML fragment.',
            )
            expect(() => joinMailHtml([fragment])).toThrow(
                'Untrusted mail HTML fragment.',
            )
        }
    })

    it('verhindert Änderungen an bereits geprüften Fragmenten', function () {
        const fragment = mailHtml`<p>${'A & B'}</p>`

        expect(Reflect.set(fragment, 'html', '<script>alert(1)</script>')).toBe(
            false,
        )
        expect(mailHtml`<div>${fragment}</div>`.html).toBe(
            '<div><p>A &amp; B</p></div>',
        )
    })
})
