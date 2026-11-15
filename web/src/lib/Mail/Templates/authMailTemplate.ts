import de from '@/language/Locales/de.json'
import type {
    AuthMailContent,
    AuthMailTemplateInput,
    MailTheme,
} from '../Types/mail-template.types.ts'
import { createMailTheme } from '../mailTheme.ts'
import { mailHtml } from './templateUtils.ts'
import {
    createMailButton,
    createMailLayout,
    createMailPanel,
} from './mailLayout.ts'

export function createAuthMailContent(
    { headline, intro, resetLink }: AuthMailTemplateInput,
    theme: MailTheme = createMailTheme(),
): AuthMailContent {
    const messages = de.mailTemplates.auth
    const text = [
        headline,
        intro,
        messages.instruction,
        resetLink,
        messages.ignore,
    ].join('\n\n')
    const action = createMailPanel(
        mailHtml`
        <p style="margin:0 0 20px;color:${theme.colors.foreground};font-size:${theme.fontSize}px;line-height:1.7;font-weight:500;">${messages.instruction}</p>
        ${createMailButton(messages.action, resetLink, theme)}
    `,
        theme,
    )
    const html = createMailLayout({
        title: headline,
        previewText: intro,
        theme,
        content: mailHtml`
            <p style="margin:0 0 24px;color:${theme.colors.foreground};font-size:${theme.fontSize}px;line-height:1.7;">${intro}</p>
            ${action}
            <p style="margin:24px 0 8px;color:${theme.colors.secondaryText};font-size:${theme.fontSize - 3}px;line-height:1.65;">${messages.linkHint}</p>
            <p style="margin:0 0 24px;font-size:${theme.fontSize - 3}px;line-height:1.65;word-break:break-all;overflow-wrap:anywhere;">
                <a href="${resetLink}" style="color:${theme.primaryText};text-decoration:underline;word-break:break-all;">${resetLink}</a>
            </p>
            <p style="margin:0;color:${theme.colors.secondaryText};font-size:${theme.fontSize - 3}px;line-height:1.65;">${messages.ignore}</p>
        `,
    })

    return { text, html }
}
