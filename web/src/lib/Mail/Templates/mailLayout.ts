import { PROJECT_CONFIG } from '@/config/app.config.ts'
import de from '@/language/Locales/de.json'
import type {
    MailHtmlFragment,
    MailLayoutInput,
    MailTheme,
} from '../Types/mail-template.types.ts'
import { mailHtml } from './templateUtils.ts'

export function createMailLayout({
    title,
    previewText,
    content,
    theme,
}: MailLayoutInput): string {
    const { colors, fontFamily, fontSize } = theme

    return mailHtml`<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
    <style>
        :root { color-scheme: light; supported-color-schemes: light; }
        body, table, td, th { font-family: inherit; }
        table { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        @media only screen and (max-width: 480px) {
            .mail-heading { font-size: ${fontSize * 1.25}px !important; line-height: 1.4 !important; }
            .mail-panel { padding: 20px !important; }
            .mail-card-padding { padding: 22px 20px !important; }
            .mail-card { border-top: 3px solid ${theme.primaryColor} !important; }
            .mail-header-icon { display: none !important; }
            .mail-header-copy { padding-left: 0 !important; }
            .mail-outer { padding-top: 24px !important; padding-bottom: 24px !important; }
        }
    </style>
</head>
<body bgcolor="#ffffff" style="margin:0;padding:0;width:100%;background-color:#ffffff;color:${colors.foreground};font-family:${fontFamily};font-size:${fontSize}px;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${previewText}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;">
        <tr>
            <td align="center" class="mail-outer" style="padding:44px 16px;">
                <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
                <table role="presentation" class="mail-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.surface}" style="width:100%;max-width:640px;margin:0 auto;table-layout:fixed;background-color:${colors.surface};border:1px solid ${colors.border};border-radius:12px;">
                    <tr>
                        <td class="mail-card-padding" style="padding:28px;font-family:${fontFamily};">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
                                <tr>
                                    <td class="mail-header-icon" width="42" valign="top" style="width:42px;">
                                        <table role="presentation" width="42" cellpadding="0" cellspacing="0" border="0">
                                            <tr><td width="42" height="42" align="center" bgcolor="${colors.background}" style="width:42px;height:42px;background-color:${colors.background};border:1px solid ${colors.border};border-left:3px solid ${theme.primaryColor};border-radius:6px;color:${colors.foreground};font-family:${fontFamily};font-size:22px;line-height:42px;font-weight:700;">${PROJECT_CONFIG.defaultName.slice(0, 1).toUpperCase()}</td></tr>
                                        </table>
                                    </td>
                                    <td class="mail-header-copy" valign="top" style="padding-left:14px;font-family:${fontFamily};">
                                        ${createMailHeading(title, theme)}
                                        <p style="margin:5px 0 0;color:${colors.secondaryText};font-size:${fontSize - 3}px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;">${PROJECT_CONFIG.defaultName}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td class="mail-card-padding" bgcolor="${colors.background}" style="padding:28px;border-top:1px solid ${colors.border};background-color:${colors.background};color:${colors.foreground};font-family:${fontFamily};font-size:${fontSize}px;line-height:1.7;word-break:break-word;overflow-wrap:anywhere;">
                            ${content}
                        </td>
                    </tr>
                    <tr>
                        <td class="mail-card-padding" style="padding:18px 28px;border-top:1px solid ${colors.border};color:${colors.secondaryText};font-family:${fontFamily};font-size:${Math.max(12, fontSize - 4)}px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;">
                            <p style="margin:0;">${de.mailTemplates.footer}</p>
                        </td>
                    </tr>
                </table>
                <!--[if mso]></td></tr></table><![endif]-->
            </td>
        </tr>
    </table>
</body>
</html>`.html
}

export function createMailHeading(
    title: string,
    theme: MailTheme,
    level: 'h1' | 'h2' = 'h1',
): MailHtmlFragment {
    return mailHtml`<${level} class="mail-heading" style="margin:0;color:${theme.colors.foreground};font-family:${theme.fontFamily};font-size:${theme.fontSize * 1.375}px;line-height:1.4;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${title}</${level}>`
}

export function createMailPanel(
    content: MailHtmlFragment,
    theme: MailTheme,
): MailHtmlFragment {
    return mailHtml`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.colors.input}" style="width:100%;table-layout:fixed;background-color:${theme.colors.input};border:1px solid ${theme.colors.border};border-radius:8px;">
        <tr><td class="mail-panel" style="padding:22px;color:${theme.colors.foreground};font-family:${theme.fontFamily};font-size:${theme.fontSize}px;line-height:1.7;">${content}</td></tr>
    </table>`
}

export function createMailButton(
    label: string,
    link: string,
    theme: MailTheme,
): MailHtmlFragment {
    return mailHtml`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
        <tr><td align="center" bgcolor="${theme.primaryColor}" style="background-color:${theme.primaryColor};border-radius:6px;mso-padding-alt:14px 20px;">
            <a href="${link}" style="display:block;padding:14px 20px;color:${theme.primaryForeground};font-family:${theme.fontFamily};font-size:${theme.fontSize - 1}px;line-height:1.5;font-weight:600;text-align:center;text-decoration:none;border-radius:6px;">${label}</a>
        </td></tr>
    </table>`
}

export function createMailNotice(
    message: string,
    theme: MailTheme,
): MailHtmlFragment {
    return mailHtml`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.noticeBackground}" style="width:100%;table-layout:fixed;background-color:${theme.noticeBackground};border-radius:6px;">
        <tr><td style="padding:16px 18px;border-left:3px solid ${theme.colors.warning};color:${theme.colors.warning};font-family:${theme.fontFamily};font-size:${theme.fontSize - 2}px;line-height:1.65;">${message}</td></tr>
    </table>`
}
