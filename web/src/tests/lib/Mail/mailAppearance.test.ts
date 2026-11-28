import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'
import type { SendSmtpMailInput } from '@/lib/Mail/Types/mail-client.types.ts'

let appearance = createMailTheme()
const themeLookup = vi.fn(async function (_recipient: string) {
    return appearance
})
const sendWithSmtp = vi.fn(async function (_input: SendSmtpMailInput) {})
vi.mock('@/server/Mail/mail-theme.service.ts', () => ({
    getRecipientMailThemeService: themeLookup,
}))
vi.mock('@/lib/Mail/nodemailerClient.ts', () => ({ sendWithSmtp }))
const {
    sendPasswordResetMail,
    sendPasswordSetupMail,
    sendFailedLoginAlertMail,
    sendSecurityChangeMail,
} = await import('@/lib/Mail/mail.ts')

const recipient = 'recipient@example.test'
const authInput = {
    to: recipient,
    username: 'Test',
    resetLink: 'https://example.test/password-reset#token=synthetic',
}
const flows = [
    { name: 'Passwort-Reset', send: () => sendPasswordResetMail(authInput) },
    { name: 'Einladung', send: () => sendPasswordSetupMail(authInput) },
    {
        name: 'Login-Warnung',
        send: () =>
            sendFailedLoginAlertMail({
                to: recipient,
                username: 'Test',
                ip: null,
                location: null,
                device: null,
                browser: null,
                mapsLink: null,
                attemptedAt: '02.10.2026, 10:24:00',
            }),
    },
    {
        name: 'Sicherheitsänderung',
        send: () =>
            sendSecurityChangeMail({
                to: recipient,
                change: 'totp_enabled',
                changedAt: '2026-10-02T08:24:00.000Z',
                auditEventId: '0197f495-622c-70ad-9fd4-11edce58c001',
            }),
    },
] as const

beforeEach(function () {
    vi.clearAllMocks()
    appearance = createMailTheme()
})

describe('Persönliches Design beim Mailversand', function () {
    it.each([...flows])(
        'übernimmt für $name die aktuellen Empfängereinstellungen',
        async function ({ send }) {
            appearance = createMailTheme({
                themeMode: 'dark',
                primaryColor: '#7c3aed',
                fontFamily: 'mono',
                fontSize: 18,
            })
            await send()
            const first = sendWithSmtp.mock.calls[0]?.[0]
            expect(first?.html).toContain('border-left:3px solid #7c3aed')
            expect(first?.html).toContain('font-size:18px')
            expect(first?.html).toContain('bgcolor="#0a110e"')

            appearance = createMailTheme({
                themeMode: 'light',
                primaryColor: '#059669',
                fontFamily: 'serif',
                fontSize: 14,
            })
            await send()
            const second = sendWithSmtp.mock.calls[1]?.[0]
            expect(second?.html).toContain('border-left:3px solid #059669')
            expect(second?.html).toContain('font-size:14px')
            expect(second?.html).toContain(
                'font-family:Georgia, Cambria, serif',
            )
            expect(second?.html).toContain('<body bgcolor="#ffffff"')
            expect(second?.html).not.toContain('#7c3aed')
            expect(second?.text).toBe(first?.text)
            expect(second?.subject).toBe(first?.subject)
            expect(second?.to).toBe(recipient)
            expect(themeLookup).toHaveBeenCalledTimes(2)
            expect(themeLookup).toHaveBeenNthCalledWith(1, recipient)
            expect(themeLookup).toHaveBeenNthCalledWith(2, recipient)
            expect(Object.keys(second ?? {}).toSorted()).toEqual([
                'html',
                'subject',
                'text',
                'to',
            ])
        },
    )
})
