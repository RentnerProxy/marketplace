import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'
import type { SendSmtpMailInput } from '@/lib/Mail/Types/mail-client.types.ts'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'

const sendWithSmtp = vi.fn(async function (_input: SendSmtpMailInput) {})
vi.mock('@/lib/Mail/nodemailerClient.ts', () => ({ sendWithSmtp }))
vi.mock('@/server/Mail/mail-theme.service.ts', () => ({
    getRecipientMailThemeService: async function () {
        return createMailTheme()
    },
}))
const { sendPasswordResetMail, sendPasswordSetupMail } =
    await import('@/lib/Mail/mail.ts')

beforeEach(function () {
    sendWithSmtp.mockClear()
})

describe('fragment links through the real authentication mail renderers', function () {
    it.each([
        {
            name: 'password reset',
            send: sendPasswordResetMail,
            subject: 'Passwort zurücksetzen',
        },
        {
            name: 'account invitation',
            send: sendPasswordSetupMail,
            subject: 'Einladung ins Marketplace-Team',
        },
    ])(
        'preserves and escapes the $name link in HTML and text',
        async function (flow) {
            const resetLink = createPasswordResetLinkService(
                'https://example.test',
                'legacy\'"<&?#+%>',
            )
            const expectedLink =
                "https://example.test/password-reset#token=legacy'%22%3C%26%3F%23%2B%25%3E"
            expect(resetLink).toBe(expectedLink)

            await flow.send({
                to: 'recipient@example.test',
                username: '<img src=x> & "quoted" \'single\'',
                resetLink,
            })

            expect(sendWithSmtp).toHaveBeenCalledTimes(1)
            const message = sendWithSmtp.mock.calls[0]?.[0]
            expect(message?.to).toBe('recipient@example.test')
            expect(message?.subject).toBe(flow.subject)
            expect(message?.text).toContain(expectedLink)
            expect(message?.html).toContain(
                'href="https://example.test/password-reset#token=legacy&#039;%22%3C%26%3F%23%2B%25%3E"',
            )
            expect(message?.html).toContain(
                '&lt;img src=x&gt; &amp; &quot;quoted&quot; &#039;single&#039;',
            )
            expect(message?.html).not.toContain('<img')
            expect(message?.text).not.toContain('/password-reset?token=')
            expect(message?.html).not.toContain('/password-reset?token=')
            expect(Object.keys(message ?? {}).toSorted()).toEqual([
                'html',
                'subject',
                'text',
                'to',
            ])
        },
    )
})
