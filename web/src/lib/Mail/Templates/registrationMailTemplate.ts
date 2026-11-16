import type { AuthMailInput } from '../Types/mail-domain.types.ts'
import type { MailTheme } from '../Types/mail-template.types.ts'
import { createMailButton, createMailLayout } from './mailLayout.ts'
import { mailHtml } from './templateUtils.ts'

export function createRegistrationMailContent(
    input: AuthMailInput,
    theme: MailTheme,
) {
    const title = 'E-Mail-Adresse bestätigen / Verify your email'
    const intro = `Hallo ${input.username}, bestätige deine E-Mail-Adresse, um deinen Account zu erstellen. / Verify your email to create your account.`
    const notice =
        'Der Link ist eine Stunde gültig. Falls du die Registrierung nicht angefordert hast, ignoriere diese E-Mail. / This link expires in one hour. Ignore this message if you did not sign up.'
    return {
        text: [title, intro, input.resetLink, notice].join('\n\n'),
        html: createMailLayout({
            title,
            previewText: intro,
            theme,
            content: mailHtml`
            <p>${intro}</p>
            ${createMailButton('E-Mail bestätigen / Verify email', input.resetLink, theme)}
            <p><a href="${input.resetLink}">${input.resetLink}</a></p>
            <p>${notice}</p>
        `,
        }),
    }
}
