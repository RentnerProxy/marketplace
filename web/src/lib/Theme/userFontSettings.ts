import {
    USER_FONT_FAMILIES,
    USER_FONT_SIZES,
} from '@/config/user-theme-colors.config.ts'
import type { UserFontFamily, UserFontSize } from './Types/userTheme.types.ts'

export function isUserFontFamily(value: unknown): value is UserFontFamily {
    return USER_FONT_FAMILIES.some((fontFamily) => fontFamily === value)
}

export function isUserFontSize(value: unknown): value is UserFontSize {
    return USER_FONT_SIZES.some((fontSize) => fontSize === value)
}
