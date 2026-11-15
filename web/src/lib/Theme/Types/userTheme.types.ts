export type UserThemeMode = 'dark' | 'light'
export type UserFontFamily = 'inter' | 'system' | 'serif' | 'mono'
export type UserFontSize = 14 | 15 | 16 | 17 | 18

export type AppThemeSettings = {
    fontFamily: UserFontFamily
    fontSize: UserFontSize
    primaryColor: string
    primaryColorHover: string
    themeMode: UserThemeMode
}

export type UserThemeColors = {
    background: string
    border: string
    danger: string
    focusRing: string
    foreground: string
    input: string
    secondaryText: string
    success: string
    surface: string
    warning: string
}
