import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'
import { createSecurityChangeMailContent } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'
import type { SendSmtpMailInput } from '@/lib/Mail/Types/mail-client.types.ts'
import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'

const sendWithSmtp = vi.fn(async function (_input: SendSmtpMailInput) {})
vi.mock('@/lib/Mail/nodemailerClient.ts', () => ({ sendWithSmtp }))
vi.mock('@/server/Mail/mail-theme.service.ts', () => ({
    getRecipientMailThemeService: async function () {
        return createMailTheme()
    },
}))
const { sendSecurityChangeMail } = await import('@/lib/Mail/mail.ts')

const changedAt = '2026-09-06T18:25:34.567Z'
const subject = 'Sicherheitsänderung / Security change'
const changes = [
    [
        'password_changed',
        'Das Passwort für dein Konto wurde geändert.',
        'The password for your account was changed.',
    ],
    [
        'totp_enabled',
        'Die Zwei-Faktor-Authentifizierung (2FA) wurde für dein Konto aktiviert.',
        'Two-factor authentication (2FA) was enabled for your account.',
    ],
    [
        'totp_disabled',
        'Die Zwei-Faktor-Authentifizierung (2FA) wurde für dein Konto deaktiviert.',
        'Two-factor authentication (2FA) was disabled for your account.',
    ],
    [
        'passkey_added',
        'Ein Passkey wurde zu deinem Konto hinzugefügt.',
        'A passkey was added to your account.',
    ],
    [
        'passkey_removed',
        'Ein Passkey wurde aus deinem Konto entfernt.',
        'A passkey was removed from your account.',
    ],
] as const

beforeEach(function () {
    sendWithSmtp.mockReset()
    sendWithSmtp.mockImplementation(async function () {})
})

describe('Security-change mail content', function () {
    it('covers all five supported changes with a distinct translated notice', function () {
        expect(changes.map(([change]) => change)).toEqual([
            ...SECURITY_CHANGE_TYPES,
        ])
        expect(new Set(changes.map(([, german]) => german)).size).toBe(5)
        expect(new Set(changes.map(([, , english]) => english)).size).toBe(5)
    })

    it.each(changes)(
        'describes %s in German and English as text and HTML',
        function (change, german, english) {
            const content = createSecurityChangeMailContent({
                change,
                changedAt,
            })
            expect(Object.keys(content).toSorted()).toEqual(['html', 'text'])
            for (const body of [content.text, content.html]) {
                expect(body).toContain(german)
                expect(body).toContain(english)
                expect(body).toContain('Zeitpunkt (UTC): ' + changedAt)
                expect(body).toContain('Time (UTC): ' + changedAt)
                expect(body).toContain(
                    'öffne die Anwendung selbst über deine bekannte Adresse',
                )
                expect(body).toContain('verständige deine Administration')
                expect(body).toContain(
                    'open the application yourself using your known address',
                )
                expect(body).toContain('contact your administrator')
                expect(body).not.toContain('/password-reset')
                expect(body).not.toMatch(/https?:\/\//)
            }
            expect(content.html).toContain('<section lang="de"')
            expect(content.html).toContain('<section lang="en"')
            expect(content.html).not.toMatch(/<(?:a|img|script|iframe)\b/i)
        },
    )

    it('escapes every timestamp character with HTML meaning while preserving text content', function () {
        const timestamp =
            '2026-09-06T18:25:34.567Z <img src=x> & "quoted" \'single\''
        const content = createSecurityChangeMailContent({
            change: 'password_changed',
            changedAt: timestamp,
        })
        expect(content.html).toContain(
            '&lt;img src=x&gt; &amp; &quot;quoted&quot; &#039;single&#039;',
        )
        expect(content.html).not.toContain('<img')
        expect(content.text).toContain(timestamp)
    })

    it.each([
        undefined,
        null,
        false,
        7,
        '__proto__',
        'constructor',
        'toString',
        'PASSWORD_CHANGED',
        'password_changed\n',
    ])(
        'rejects an unsupported change without rendering or sending it',
        function (change) {
            expect(() =>
                Reflect.apply(createSecurityChangeMailContent, undefined, [
                    { change, changedAt },
                ]),
            ).toThrow('Unsupported security change.')
            expect(sendWithSmtp).not.toHaveBeenCalled()
        },
    )

    it('never coerces an unknown change object or reads unrelated input fields', function () {
        const read = vi.fn(function () {
            throw new Error('synthetic private detail')
        })
        const change = new Proxy({}, { get: read })
        expect(() =>
            Reflect.apply(createSecurityChangeMailContent, undefined, [
                { change, changedAt },
            ]),
        ).toThrow('Unsupported security change.')
        const input = Object.defineProperties(
            { change: 'totp_enabled' as const, changedAt },
            {
                username: { get: read },
                to: { get: read },
                auditEventId: { get: read },
                password: { get: read },
            },
        )
        expect(() => createSecurityChangeMailContent(input)).not.toThrow()
        expect(read).not.toHaveBeenCalled()
    })
})

describe('Security-change mail sender', function () {
    it.each([...SECURITY_CHANGE_TYPES])(
        'sends only recipient, fixed subject and escaped content for %s',
        async function (change) {
            const input: SecurityChangeMailInput = {
                to: 'recipient@example.test',
                change,
                changedAt,
                auditEventId: '0197f495-622c-70ad-9fd4-11edce58c001',
            }
            expect(await sendSecurityChangeMail(input)).toBeUndefined()
            expect(sendWithSmtp).toHaveBeenCalledTimes(1)
            expect(sendWithSmtp).toHaveBeenCalledWith({
                to: input.to,
                subject,
                ...createSecurityChangeMailContent({ change, changedAt }),
            })
            expect(
                Object.keys(sendWithSmtp.mock.calls[0]?.[0] ?? {}).toSorted(),
            ).toEqual(['html', 'subject', 'text', 'to'])
        },
    )

    it('does not pass audit IDs, credentials, request data or supplied headers into SMTP', async function () {
        const input = {
            to: 'recipient@example.test',
            change: 'passkey_removed' as const,
            changedAt,
            auditEventId: 'private-audit-identifier',
            username: 'private-user-name',
            password: 'private-password-value',
            token: 'private-auth-token',
            ip: '198.51.100.42',
            subject: 'injected\r\nBcc: forbidden@example.test',
            resetLink: 'https://forbidden.example.test/auth/private-token',
        }
        await sendSecurityChangeMail(input)
        const sent = sendWithSmtp.mock.calls[0]?.[0]
        expect(sent?.subject).toBe(subject)
        expect(sent?.subject).not.toMatch(/[\r\n]/)
        for (const excluded of [
            input.auditEventId,
            input.username,
            input.password,
            input.token,
            input.ip,
            input.subject,
            input.resetLink,
        ]) {
            expect(JSON.stringify(sent)).not.toContain(excluded)
        }
        expect(sent?.text).not.toContain(input.to)
        expect(sent?.html).not.toContain(input.to)
        expect(Object.keys(sent ?? {}).toSorted()).toEqual([
            'html',
            'subject',
            'text',
            'to',
        ])
    })

    it('does not read the audit event identifier when rendering or sending', async function () {
        const read = vi.fn(function (): string {
            throw new Error('private audit identifier')
        })
        const input = Object.defineProperty(
            {
                to: 'recipient@example.test',
                change: 'passkey_added' as const,
                changedAt,
                auditEventId: '',
            },
            'auditEventId',
            { get: read },
        )
        await sendSecurityChangeMail(input)
        expect(sendWithSmtp).toHaveBeenCalledTimes(1)
        expect(read).not.toHaveBeenCalled()
    })

    it('rejects an unknown change before the SMTP boundary', async function () {
        await expect(
            Reflect.apply(sendSecurityChangeMail, undefined, [
                {
                    to: 'recipient@example.test',
                    change: 'unknown-change',
                    changedAt,
                    auditEventId: 'private-audit-identifier',
                },
            ]),
        ).rejects.toThrow('Unsupported security change.')
        expect(sendWithSmtp).not.toHaveBeenCalled()
    })

    it('preserves SMTP failure for the existing queue retry policy', async function () {
        const failure = new Error('synthetic SMTP failure')
        sendWithSmtp.mockRejectedValueOnce(failure)
        await expect(
            sendSecurityChangeMail({
                to: 'recipient@example.test',
                change: 'password_changed',
                changedAt,
                auditEventId: 'private-audit-identifier',
            }),
        ).rejects.toBe(failure)
        expect(sendWithSmtp).toHaveBeenCalledTimes(1)
    })
})
