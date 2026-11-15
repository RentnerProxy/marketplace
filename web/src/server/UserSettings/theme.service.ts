import { eq } from 'drizzle-orm'
import { user_settings } from '@/db/schema.ts'
import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_THEME_MODE,
} from '@/config/user-theme-colors.config.ts'
import {
    isUserFontFamily,
    isUserFontSize,
} from '@/lib/Theme/userFontSettings.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import { runAuditedUserSettingsMutationService } from './settings-mutation.service.ts'
import type {
    UpdateCurrentUserFontFamilyInput,
    UpdateCurrentUserFontSizeInput,
    UpdateCurrentUserPrimaryColorInput,
    UpdateCurrentUserThemeModeInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'

export async function updateCurrentUserThemeModeService(
    data: UpdateCurrentUserThemeModeInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.theme_mode_updated',
            message: 'Darstellungsmodus wurde aktualisiert.',
        },
        async function (transaction) {
            const previousRows = await transaction
                .select({ themeMode: user_settings.themeMode })
                .from(user_settings)
                .where(eq(user_settings.userId, currentUser.id))
                .limit(1)
            const previous = previousRows.at(0)
            if (
                previous &&
                isUserThemeMode(previous.themeMode) &&
                previous.themeMode === data.themeMode
            ) {
                return {
                    changed: false as const,
                    value: {
                        success: true as const,
                        themeMode: previous.themeMode,
                    },
                }
            }
            const rows = await transaction
                .insert(user_settings)
                .values({ userId: currentUser.id, themeMode: data.themeMode })
                .onConflictDoUpdate({
                    target: user_settings.userId,
                    set: { themeMode: data.themeMode },
                })
                .returning({ themeMode: user_settings.themeMode })
            const updated = rows.at(0)
            if (!updated)
                throw new Error('User settings update did not return a row')
            const value = isUserThemeMode(updated.themeMode)
                ? updated.themeMode
                : data.themeMode

            return {
                changed: true as const,
                value: { success: true as const, themeMode: value },
                oldValues: {
                    themeMode: isUserThemeMode(previous?.themeMode)
                        ? previous.themeMode
                        : DEFAULT_THEME_MODE,
                },
                newValues: { themeMode: value },
            }
        },
    )
}

export async function updateCurrentUserFontFamilyService(
    data: UpdateCurrentUserFontFamilyInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.font_family_updated',
            message: 'Schriftart wurde aktualisiert.',
        },
        async function (transaction) {
            const previousRows = await transaction
                .select({ fontFamily: user_settings.fontFamily })
                .from(user_settings)
                .where(eq(user_settings.userId, currentUser.id))
                .limit(1)
            const previous = previousRows.at(0)
            if (
                previous &&
                isUserFontFamily(previous.fontFamily) &&
                previous.fontFamily === data.fontFamily
            ) {
                return {
                    changed: false as const,
                    value: {
                        success: true as const,
                        fontFamily: previous.fontFamily,
                    },
                }
            }
            const rows = await transaction
                .insert(user_settings)
                .values({ userId: currentUser.id, fontFamily: data.fontFamily })
                .onConflictDoUpdate({
                    target: user_settings.userId,
                    set: { fontFamily: data.fontFamily },
                })
                .returning({ fontFamily: user_settings.fontFamily })
            const updated = rows.at(0)
            if (!updated)
                throw new Error('User settings update did not return a row')
            const value = isUserFontFamily(updated.fontFamily)
                ? updated.fontFamily
                : data.fontFamily

            return {
                changed: true as const,
                value: { success: true as const, fontFamily: value },
                oldValues: {
                    fontFamily: isUserFontFamily(previous?.fontFamily)
                        ? previous.fontFamily
                        : DEFAULT_FONT_FAMILY,
                },
                newValues: { fontFamily: value },
            }
        },
    )
}

export async function updateCurrentUserFontSizeService(
    data: UpdateCurrentUserFontSizeInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.font_size_updated',
            message: 'Schriftgröße wurde aktualisiert.',
        },
        async function (transaction) {
            const previousRows = await transaction
                .select({ fontSize: user_settings.fontSize })
                .from(user_settings)
                .where(eq(user_settings.userId, currentUser.id))
                .limit(1)
            const previous = previousRows.at(0)
            if (
                previous &&
                isUserFontSize(previous.fontSize) &&
                previous.fontSize === data.fontSize
            ) {
                return {
                    changed: false as const,
                    value: {
                        success: true as const,
                        fontSize: previous.fontSize,
                    },
                }
            }
            const rows = await transaction
                .insert(user_settings)
                .values({ userId: currentUser.id, fontSize: data.fontSize })
                .onConflictDoUpdate({
                    target: user_settings.userId,
                    set: { fontSize: data.fontSize },
                })
                .returning({ fontSize: user_settings.fontSize })
            const updated = rows.at(0)
            if (!updated)
                throw new Error('User settings update did not return a row')
            const value = isUserFontSize(updated.fontSize)
                ? updated.fontSize
                : data.fontSize

            return {
                changed: true as const,
                value: { success: true as const, fontSize: value },
                oldValues: {
                    fontSize: isUserFontSize(previous?.fontSize)
                        ? previous.fontSize
                        : DEFAULT_FONT_SIZE,
                },
                newValues: { fontSize: value },
            }
        },
    )
}

export async function updateCurrentUserPrimaryColorService(
    data: UpdateCurrentUserPrimaryColorInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.primary_color_updated',
            message: 'Primärfarbe wurde aktualisiert.',
        },
        async function (transaction) {
            const previousRows = await transaction
                .select({ primaryColor: user_settings.primaryColor })
                .from(user_settings)
                .where(eq(user_settings.userId, currentUser.id))
                .limit(1)
            const previous = previousRows.at(0)
            if (
                previous &&
                previous.primaryColor?.length === 7 &&
                /^#[0-9a-f]{6}$/iu.test(previous.primaryColor) &&
                previous.primaryColor === data.primaryColor
            ) {
                return {
                    changed: false as const,
                    value: {
                        success: true as const,
                        primaryColor: previous.primaryColor,
                    },
                }
            }
            const rows = await transaction
                .insert(user_settings)
                .values({
                    userId: currentUser.id,
                    primaryColor: data.primaryColor,
                })
                .onConflictDoUpdate({
                    target: user_settings.userId,
                    set: { primaryColor: data.primaryColor },
                })
                .returning({ primaryColor: user_settings.primaryColor })
            const updated = rows.at(0)
            if (!updated)
                throw new Error('User settings update did not return a row')
            const value = updated.primaryColor ?? data.primaryColor

            return {
                changed: true as const,
                value: { success: true as const, primaryColor: value },
                oldValues: {
                    primaryColor:
                        previous?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
                },
                newValues: { primaryColor: value },
            }
        },
    )
}

export async function resetCurrentUserPrimaryColorService() {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.primary_color_reset',
            message: 'Primärfarbe wurde zurückgesetzt.',
        },
        async function (transaction) {
            const previousRows = await transaction
                .select({ primaryColor: user_settings.primaryColor })
                .from(user_settings)
                .where(eq(user_settings.userId, currentUser.id))
                .limit(1)
            const previous = previousRows.at(0)
            if (previous?.primaryColor === null) {
                return {
                    changed: false as const,
                    value: {
                        success: true as const,
                        primaryColor: DEFAULT_PRIMARY_COLOR,
                    },
                }
            }
            const rows = await transaction
                .insert(user_settings)
                .values({ userId: currentUser.id, primaryColor: null })
                .onConflictDoUpdate({
                    target: user_settings.userId,
                    set: { primaryColor: null },
                })
                .returning({ primaryColor: user_settings.primaryColor })
            const updated = rows.at(0)
            if (!updated)
                throw new Error('User settings update did not return a row')
            const value = DEFAULT_PRIMARY_COLOR

            return {
                changed: true as const,
                value: { success: true as const, primaryColor: value },
                oldValues: {
                    primaryColor:
                        previous?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
                },
                newValues: { primaryColor: value },
            }
        },
    )
}
