import { describe, expect, it } from 'bun:test'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'
import { createAuthMailContent } from '@/lib/Mail/Templates/authMailTemplate.ts'
import { createFailedLoginAlertMailContent } from '@/lib/Mail/Templates/failedLoginAlertMailTemplate.ts'
import {
    createSecurityChangeMailContent,
    SECURITY_CHANGE_TYPES,
} from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'

describe('Persönliches Maildesign', function () {
    it.each(['dark', 'light'] as const)(
        'behält für alle Templates im Modus %s den weißen Außenbereich',
        function (themeMode) {
            const theme = createMailTheme({
                themeMode,
                primaryColor: '#7c3aed',
                fontFamily: 'serif',
                fontSize: 18,
            })
            const templates = [
                createAuthMailContent(
                    {
                        headline: 'Passwort zurücksetzen',
                        intro: 'Hallo Test, setze dein Passwort zurück.',
                        resetLink:
                            'https://example.test/password-reset#token=test',
                    },
                    theme,
                ),
                createFailedLoginAlertMailContent(
                    {
                        to: 'recipient@example.test',
                        username: 'Test',
                        ip: null,
                        location: null,
                        device: null,
                        browser: null,
                        attemptedAt: '02.10.2026, 10:24:00',
                        mapsLink: null,
                    },
                    theme,
                ),
                ...SECURITY_CHANGE_TYPES.map((change) =>
                    createSecurityChangeMailContent(
                        {
                            change,
                            changedAt: '2026-10-02T08:24:00.000Z',
                        },
                        theme,
                    ),
                ),
            ]

            for (const { html } of templates) {
                expect(html).toContain('<body bgcolor="#ffffff"')
                expect(html).toContain('width:100%;background-color:#ffffff;')
                expect(html).toContain('class="mail-card"')
                expect(html).toContain(`bgcolor="${theme.colors.surface}"`)
                expect(html).toContain('border-left:3px solid #7c3aed')
                expect(html).toContain('font-family:Georgia, Cambria, serif')
                expect(html).toContain('font-size:18px')
            }
        },
    )

    it('übernimmt nur gültige Farben und Schrift-Einstellungen in HTML und CSS', function () {
        const invalid = createMailTheme({
            themeMode: 'dark"><script>',
            primaryColor: '#fff; background-image:url(https://unsafe.test)',
            fontFamily: 'serif; color:red',
            fontSize: 900,
        })

        expect(invalid).toEqual(createMailTheme())
        expect(createMailTheme({ primaryColor: '#ffffff\n' })).toEqual(
            createMailTheme(),
        )
        expect(
            createMailTheme({
                themeMode: null,
                primaryColor: null,
                fontFamily: null,
                fontSize: null,
            }),
        ).toEqual(createMailTheme())
    })

    it.each(['inter', 'mono'] as const)(
        'hält das Stylesheet für die Schrift %s frei von HTML-Entities',
        function (fontFamily) {
            const { html } = createAuthMailContent(
                {
                    headline: 'Passwort zurücksetzen',
                    intro: 'Hallo Test.',
                    resetLink: 'https://example.test/password-reset#token=test',
                },
                createMailTheme({ fontFamily }),
            )
            const stylesheet = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1]

            expect(stylesheet).toBeDefined()
            expect(stylesheet).not.toMatch(/&(?:quot|amp|lt|gt|#039);/u)
        },
    )

    it('hält Buttons und Links auch bei einer sehr hellen Akzentfarbe lesbar', function () {
        const theme = createMailTheme({
            themeMode: 'light',
            primaryColor: '#FFFFFF',
        })

        expect(theme.primaryColor).toBe('#ffffff')
        expect(theme.primaryForeground).toBe('#000000')
        expect(theme.primaryText).not.toBe('#ffffff')
    })
})
