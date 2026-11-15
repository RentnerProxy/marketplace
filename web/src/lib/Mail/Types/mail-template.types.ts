import type { SecurityChangeMailInput } from './mail-domain.types.ts'
import type {
    UserFontSize,
    UserThemeColors,
} from '@/lib/Theme/Types/userTheme.types.ts'

export type AuthMailTemplateInput = {
    headline: string
    intro: string
    resetLink: string
}

export type AuthMailContent = {
    text: string
    html: string
}

export type MailHtmlFragment = Readonly<{
    html: string
}>

export type MailHtmlInterpolation = string | number | MailHtmlFragment

export type MailLayoutInput = {
    title: string
    previewText: string
    content: MailHtmlFragment
    theme: MailTheme
}

export type MailThemeInput = {
    themeMode?: string | null
    primaryColor?: string | null
    fontFamily?: string | null
    fontSize?: number | null
}

export type MailTheme = {
    colors: UserThemeColors
    primaryColor: string
    primaryForeground: string
    primaryText: string
    fontFamily: string
    fontSize: UserFontSize
    noticeBackground: string
}

export type SecurityChangeMailTemplateInput = Pick<
    SecurityChangeMailInput,
    'change' | 'changedAt'
>
