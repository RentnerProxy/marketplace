import { USER_THEME_MODES } from '@/config/user-theme-colors.config.ts'
import type { UserThemeMode } from './Types/userTheme.types.ts'

export function isUserThemeMode(value: unknown): value is UserThemeMode {
    return USER_THEME_MODES.some((themeMode) => themeMode === value)
}
