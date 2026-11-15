import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
} from '@/lib/Theme/Types/userTheme.types.ts'

export type AuthenticatedSessionQueryData = {
    expiresAt?: string
    absoluteExpiresAt?: string
    user: {
        customBackgroundDarkness: number | null
        customBackgroundUpdatedAt: string | null
        firstName: string | null
        lastName: string | null
        street: string | null
        houseNumber: string | null
        postalCode: string | null
        city: string | null
        id: string
        primaryColor: string | null
        themeMode: UserThemeMode | null
        fontFamily: UserFontFamily | null
        fontSize: UserFontSize | null
        profileImageVersion: number | null
        username: string
    } | null
    permissions?: Array<string>
}
