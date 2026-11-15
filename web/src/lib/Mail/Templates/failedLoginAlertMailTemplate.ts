import de from '@/language/Locales/de.json'
import type {
    AuthMailContent,
    MailTheme,
} from '../Types/mail-template.types.ts'
import { createMailTheme } from '../mailTheme.ts'
import type { FailedLoginAlertMailInput } from '../Types/mail-domain.types.ts'
import { joinMailHtml, mailHtml } from './templateUtils.ts'
import {
    createMailButton,
    createMailLayout,
    createMailNotice,
    createMailPanel,
} from './mailLayout.ts'

export function createFailedLoginAlertMailContent(
    input: FailedLoginAlertMailInput,
    theme: MailTheme = createMailTheme(),
): AuthMailContent {
    const messages = de.mailTemplates.failedLogin
    const details = [
        [messages.timestamp, input.attemptedAt],
        [messages.ip, input.ip ?? messages.unknown],
        [messages.location, input.location ?? messages.unknownLocation],
        [messages.device, input.device ?? messages.unknown],
        [messages.browser, input.browser ?? messages.unknown],
    ] as const
    const textDetails = details
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n')
    const mapText = input.mapsLink
        ? `\n${messages.mapText}: ${input.mapsLink}`
        : ''
    const intro = `${messages.greeting} ${input.username}, ${messages.intro}`
    const rows = joinMailHtml(
        details.map(
            ([label, value], index) => mailHtml`
                <tr>
                    <th scope="row" width="36%" align="left" valign="top" style="width:36%;padding:12px 12px 12px 0;${index === 0 ? '' : `border-top:1px solid ${theme.colors.border};`}color:${theme.colors.secondaryText};font-family:${theme.fontFamily};font-size:${theme.fontSize - 3}px;line-height:1.6;font-weight:400;">${label}</th>
                    <td valign="top" style="padding:12px 0;${index === 0 ? '' : `border-top:1px solid ${theme.colors.border};`}color:${theme.colors.foreground};font-size:${theme.fontSize - 2}px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;">${value}</td>
                </tr>`,
        ),
    )
    const mapButton = input.mapsLink
        ? mailHtml`<div style="margin-top:24px;">${createMailButton(messages.mapAction, input.mapsLink, theme)}</div>`
        : ''
    const detailsPanel = createMailPanel(
        mailHtml`
        <h2 style="margin:0 0 8px;color:${theme.colors.foreground};font-size:${theme.fontSize}px;line-height:1.5;font-weight:600;">${messages.details}</h2>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;">${rows}</table>
    `,
        theme,
    )

    return {
        text: `${messages.greeting} ${input.username},\n\n${messages.intro}\n\n${textDetails}${mapText}\n\n${messages.guidance}`,
        html: createMailLayout({
            title: messages.headline,
            previewText: intro,
            theme,
            content: mailHtml`
                <p style="margin:0 0 24px;color:${theme.colors.foreground};font-size:${theme.fontSize}px;line-height:1.7;">${intro}</p>
                ${detailsPanel}
                <div style="margin-top:24px;">${createMailNotice(messages.guidance, theme)}</div>
                ${mapButton}
            `,
        }),
    }
}
