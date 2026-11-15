import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
} from '@/lib/Theme/Types/userTheme.types.ts'

export type FontSizeLogicReturn = {
    state: {
        selectedFontSize: UserFontSize
        selectedFontFamily: UserFontFamily
        isSavingFontSize: boolean
    }
    handler: {
        handleFontSizeChange: (size: number) => void
        handleSaveFontSize: () => void
    }
}

export type FontsLogicReturn = {
    state: { selectedFontFamily: UserFontFamily; isSavingFontFamily: boolean }
    handler: {
        handleFontFamilyChange: (family: UserFontFamily) => void
        handleSaveFontFamily: () => void
    }
}

export type MainThemeLogicReturn = {
    state: {
        themeMode: UserThemeMode
        selectedThemeMode: UserThemeMode
        isSavingThemeMode: boolean
    }
    handler: {
        handleThemeModeChange: (mode: UserThemeMode) => void
        handleSaveThemeMode: () => void
    }
}

export type SystemColorLogicReturn = {
    state: {
        colorPresets: string[]
        primaryColorResetKey: number
        selectedPrimaryColor: string
        isPrimaryColorValid: boolean
        selectedPrimaryColorForeground: string
        selectedPrimaryColorHover: string
        selectedPrimaryColorTransparent: string
        isSavingPrimaryColor: boolean
    }
    handler: {
        handlePrimaryColorChange: (color: string) => void
        handlePrimaryColorValidityChange: (isValid: boolean) => void
        handleResetPrimaryColor: () => void
        handleSavePrimaryColor: () => void
    }
}
