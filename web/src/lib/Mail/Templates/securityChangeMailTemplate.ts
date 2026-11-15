import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import type {
    AuthMailContent,
    SecurityChangeMailTemplateInput,
    MailTheme,
} from '../Types/mail-template.types.ts'
import { createMailTheme } from '../mailTheme.ts'
import { joinMailHtml, mailHtml } from './templateUtils.ts'
import {
    createMailHeading,
    createMailLayout,
    createMailNotice,
    createMailPanel,
} from './mailLayout.ts'

const translations = [
    { language: 'de', messages: de.securityChangeMail },
    { language: 'en', messages: en.securityChangeMail },
] as const

export function createSecurityChangeMailContent(
    { change, changedAt }: SecurityChangeMailTemplateInput,
    theme: MailTheme = createMailTheme(),
): AuthMailContent {
    if (!SECURITY_CHANGE_TYPES.includes(change)) {
        throw new Error('Unsupported security change.')
    }

    const text = translations
        .map(({ messages }) =>
            [
                messages.headline,
                messages.changes[change],
                messages.timestamp + ': ' + changedAt,
                messages.guidance,
            ].join('\n\n'),
        )
        .join('\n\n---\n\n')
    const sections = joinMailHtml(
        translations.map(
            ({ language, messages }, index) => mailHtml`
                <section lang="${language}" style="${index === 0 ? '' : `margin-top:28px;padding-top:28px;border-top:1px solid ${theme.colors.border};`}">
                    ${index === 0 ? '' : mailHtml`<div style="margin-bottom:20px;">${createMailHeading(messages.headline, theme, 'h2')}</div>`}
                    ${createMailPanel(
                        mailHtml`
                        <p style="margin:0 0 16px;color:${theme.colors.foreground};font-size:${theme.fontSize}px;line-height:1.7;font-weight:600;">${messages.changes[change]}</p>
                        <p style="margin:0;padding-top:16px;border-top:1px solid ${theme.colors.border};color:${theme.colors.secondaryText};font-size:${theme.fontSize - 3}px;line-height:1.65;word-break:break-word;">${messages.timestamp}: ${changedAt}</p>
                    `,
                        theme,
                    )}
                    <div style="margin-top:20px;">${createMailNotice(messages.guidance, theme)}</div>
                </section>`,
        ),
    )

    const html = createMailLayout({
        title: de.securityChangeMail.headline,
        previewText: de.securityChangeMail.changes[change],
        theme,
        content: sections,
    })

    return { text, html }
}

export const SECURITY_CHANGE_TYPES = [
    'password_changed',
    'totp_enabled',
    'totp_disabled',
    'passkey_added',
    'passkey_removed',
] as const
