import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import { createAuthMailContent } from './Templates/authMailTemplate.ts'
import { createRegistrationMailContent } from './Templates/registrationMailTemplate.ts'
import { createSecurityChangeMailContent } from './Templates/securityChangeMailTemplate.ts'
import type {
    AuthMailInput,
    AuthMailMessageInput,
    FailedLoginAlertMailInput,
    SecurityChangeMailInput,
} from './Types/mail-domain.types.ts'
import { createFailedLoginAlertMailContent } from './Templates/failedLoginAlertMailTemplate.ts'
import { sendWithSmtp } from './nodemailerClient.ts'
import { getRecipientMailThemeService } from '@/server/Mail/mail-theme.service.ts'

async function sendAuthMail({
    to,
    subject,
    headline,
    intro,
    resetLink,
}: AuthMailMessageInput) {
    const theme = await getRecipientMailThemeService(to)
    const { text, html } = createAuthMailContent(
        { headline, intro, resetLink },
        theme,
    )

    await sendWithSmtp({ to, subject, text, html })
}

export async function sendPasswordResetMail(input: AuthMailInput) {
    await sendAuthMail({
        ...input,
        subject: 'Passwort zurücksetzen',
        headline: 'Passwort zurücksetzen',
        intro: `Hallo ${input.username}, über diesen Link kannst du dein Passwort zurücksetzen.`,
    })
}

export async function sendRegistrationVerificationMail(input: AuthMailInput) {
    const theme = await getRecipientMailThemeService(input.to)
    const { text, html } = createRegistrationMailContent(input, theme)
    await sendWithSmtp({
        to: input.to,
        subject: 'E-Mail-Adresse bestätigen / Verify your email',
        text,
        html,
    })
}

export async function sendPasswordSetupMail(input: AuthMailInput) {
    await sendAuthMail({
        ...input,
        subject: 'Einladung ins Marketplace-Team',
        headline: 'Einladung ins Marketplace-Team',
        intro: `Hallo ${input.username}, du wurdest ins Marketplace-Team eingeladen. Öffne den Link, um dein Teamkonto einzurichten und dein Passwort festzulegen.`,
    })
}

export async function sendFailedLoginAlertMail(
    input: FailedLoginAlertMailInput,
) {
    const subject = 'Sicherheitswarnung: fehlgeschlagener Anmeldeversuch'
    const theme = await getRecipientMailThemeService(input.to)
    const { text, html } = createFailedLoginAlertMailContent(input, theme)

    await sendWithSmtp({
        to: input.to,
        subject,
        text,
        html,
    })
}

export async function sendSecurityChangeMail(
    input: SecurityChangeMailInput,
): Promise<void> {
    const theme = await getRecipientMailThemeService(input.to)
    const { text, html } = createSecurityChangeMailContent(
        { change: input.change, changedAt: input.changedAt },
        theme,
    )

    await sendWithSmtp({
        to: input.to,
        subject:
            de.securityChangeMail.subject +
            ' / ' +
            en.securityChangeMail.subject,
        text,
        html,
    })
}
