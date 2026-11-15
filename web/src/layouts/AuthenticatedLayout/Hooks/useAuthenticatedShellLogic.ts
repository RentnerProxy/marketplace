import { useQuery } from '@tanstack/react-query'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { getCurrentBrowserPath } from '@/lib/Browser/browser.ts'
import {
    getProfileImageSrc,
    getUserBackgroundSrc,
} from '@/lib/Images/userImageUrls.ts'
import {
    DEFAULT_FAVICON_SRC,
    DEFAULT_IMAGE_64_SRC,
} from '@/lib/Images/imageFallbacks.ts'
import {
    authenticatedSessionQueryOptions,
    systemSettingsQueryOptions,
} from '@/lib/Queries/appQueries.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    DEFAULT_BACKGROUND_DARKNESS,
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_THEME_MODE,
    USER_FONT_FAMILY_STYLES,
    USER_THEME_MODE_COLORS,
} from '@/config/user-theme-colors.config.ts'
import {
    getPrimaryColorForeground,
    getPrimaryColorHover,
    getPrimaryTextColor,
} from '@/lib/Theme/primaryColor.ts'
import {
    applyAppThemeSettings,
    resetAppThemeSettings,
} from '@/lib/Theme/appTheme.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import {
    isUserFontFamily,
    isUserFontSize,
} from '@/lib/Theme/userFontSettings.ts'
import type { AuthenticatedShellLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import useAuthenticatedNavigation from './useAuthenticatedNavigation.ts'
import useAuthenticatedShellUiStore from './useAuthenticatedShellUiStore.ts'
import useAuthenticatedRealtimeEvents from './useAuthenticatedRealtimeEvents.ts'
import useSessionActivity from './useSessionActivity.ts'
import { rememberMaintenanceReturnPath } from '@/lib/Maintenance/maintenanceReturnPath.ts'
import useLocalProfileImageVersion from '@/shared/Images/Hooks/useLocalProfileImageVersion.ts'
import useRestoreNavigationBridge from '@/shared/Restore/Hooks/useRestoreNavigationBridge.ts'
import { rememberAuthenticatedRestoreUserId } from '@/lib/Restore/restoreReturnFragment.ts'

const EMPTY_PERMISSIONS: Array<string> = []

export default function useAuthenticatedShellLogic(): AuthenticatedShellLogicReturn {
    const { t } = useTranslationStore()
    const [now, setNow] = useState(() => Date.now())
    const navigate = useNavigate()
    const { state: uiState, handler: uiHandler } =
        useAuthenticatedShellUiStore()
    const { expandMaintenanceBanner, minimizeMaintenanceBanner } = uiHandler

    const sessionQuery = useQuery(authenticatedSessionQueryOptions())
    const sessionData = sessionQuery.data
    const { data: systemSettings } = useQuery(systemSettingsQueryOptions())

    const userId = sessionData?.user?.id

    useSessionActivity()
    useAuthenticatedRealtimeEvents()
    useRestoreNavigationBridge({
        clearStaleReturnPath: true,
        isPreRestoreIdentityResolved: !sessionQuery.isPending,
        preRestoreUserId: userId,
    })

    useEffect(() => {
        rememberAuthenticatedRestoreUserId(userId)
    }, [userId])

    const primaryColor =
        sessionData?.user?.primaryColor ?? DEFAULT_PRIMARY_COLOR
    const primaryColorHover = getPrimaryColorHover(primaryColor)

    const themeMode = isUserThemeMode(sessionData?.user?.themeMode)
        ? sessionData.user.themeMode
        : DEFAULT_THEME_MODE

    const fontFamily = isUserFontFamily(sessionData?.user?.fontFamily)
        ? sessionData.user.fontFamily
        : DEFAULT_FONT_FAMILY

    const fontSize = isUserFontSize(sessionData?.user?.fontSize)
        ? sessionData.user.fontSize
        : DEFAULT_FONT_SIZE

    const customBackgroundDarkness =
        sessionData?.user?.customBackgroundDarkness ??
        DEFAULT_BACKGROUND_DARKNESS

    const permissions = sessionData?.permissions ?? EMPTY_PERMISSIONS
    const navigation = useAuthenticatedNavigation(permissions)
    const canManageBackups = hasPermission(
        permissions,
        PERMISSIONS.ADMIN_BACKUPS,
    )

    const sessionProfileImageVersion =
        sessionData?.user?.profileImageVersion ?? 0

    const localProfileImageVersion = useLocalProfileImageVersion(userId, null)

    const profileImageVersion =
        localProfileImageVersion ?? sessionProfileImageVersion

    const profileImageSrc64 = userId
        ? getProfileImageSrc(userId, profileImageVersion, 64)
        : DEFAULT_IMAGE_64_SRC

    const systemLogoSrc64 = systemSettings?.logoSrc64 ?? DEFAULT_FAVICON_SRC
    const systemFaviconSrc = systemSettings?.faviconSrc ?? DEFAULT_FAVICON_SRC
    const companyName =
        systemSettings?.companyName ?? PROJECT_CONFIG.defaultName
    const themeColors = USER_THEME_MODE_COLORS[themeMode]
    const primaryForeground = getPrimaryColorForeground(primaryColor)
    const shellStyle = {
        '--color-primary': primaryColor,
        '--color-primary-foreground': primaryForeground,
        '--color-primary-hover-foreground': primaryForeground,
        '--color-primary-text': getPrimaryTextColor(
            primaryColor,
            themeColors.surface,
        ),
        '--color-primary-hover': primaryColorHover,
        '--color-background-dark': themeColors.background,
        '--color-border-dark': themeColors.border,
        '--color-danger': themeColors.danger,
        '--color-focus-ring': themeColors.focusRing,
        '--color-foreground': themeColors.foreground,
        '--color-input-dark': themeColors.input,
        '--color-secondary-text': themeColors.secondaryText,
        '--color-success': themeColors.success,
        '--color-surface-dark': themeColors.surface,
        '--color-warning': themeColors.warning,
        '--font-sans': USER_FONT_FAMILY_STYLES[fontFamily],
        colorScheme: themeMode,
        fontSize: `${fontSize}px`,
    } as CSSProperties

    const canBypassMaintenance = hasPermission(
        permissions,
        PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
    )
    const maintenanceStartsAt = systemSettings?.maintenanceStartsAt

    const millisecondsUntilMaintenance = useMemo(() => {
        if (!maintenanceStartsAt) {
            return 0
        }

        return new Date(maintenanceStartsAt).getTime() - now
    }, [maintenanceStartsAt, now])

    const showMaintenanceBanner =
        Boolean(sessionData) &&
        Boolean(systemSettings?.isMaintenanceModeScheduled) &&
        !canBypassMaintenance &&
        millisecondsUntilMaintenance > 0

    useEffect(() => {
        if (!showMaintenanceBanner) {
            return undefined
        }

        const interval = window.setInterval(() => setNow(Date.now()), 1000)

        return () => window.clearInterval(interval)
    }, [showMaintenanceBanner])

    useEffect(() => {
        if (
            systemSettings?.isMaintenanceModeScheduled &&
            !canBypassMaintenance &&
            maintenanceStartsAt &&
            millisecondsUntilMaintenance <= 0
        ) {
            const redirect = getCurrentBrowserPath()

            if (!redirect) {
                return
            }

            rememberMaintenanceReturnPath(redirect)

            void navigate({
                to: '/maintenance',
                search: {
                    redirect,
                },
            }).catch(toastAppError)
        }
    }, [
        canBypassMaintenance,
        maintenanceStartsAt,
        millisecondsUntilMaintenance,
        navigate,
        systemSettings?.isMaintenanceModeScheduled,
    ])

    useEffect(() => {
        applyAppThemeSettings({
            fontFamily,
            fontSize,
            primaryColor,
            primaryColorHover,
            themeMode,
        })
    }, [fontFamily, fontSize, primaryColor, primaryColorHover, themeMode])

    useEffect(() => {
        return resetAppThemeSettings
    }, [])

    useEffect(() => {
        document.title = companyName
    }, [companyName])

    useEffect(() => {
        if (!showMaintenanceBanner && uiState.isMaintenanceBannerMinimized) {
            expandMaintenanceBanner()
        }
    }, [
        showMaintenanceBanner,
        expandMaintenanceBanner,
        uiState.isMaintenanceBannerMinimized,
    ])

    useEffect(() => {
        const faviconLink =
            document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
            document.createElement('link')

        faviconLink.rel = 'icon'
        faviconLink.href = systemFaviconSrc

        if (!faviconLink.parentNode) {
            document.head.appendChild(faviconLink)
        }
    }, [systemFaviconSrc])

    return {
        state: {
            userId: userId ?? null,
            username: sessionData?.user?.username ?? t('nav.user'),
            companyName,
            systemLogoSrc64,
            systemFaviconSrc,
            profileImageSrc64,
            primaryColor,
            primaryColorHover,
            themeMode,
            fontFamily,
            fontSize,
            customBackgroundSrc: getUserBackgroundSrc(
                userId,
                sessionData?.user?.customBackgroundUpdatedAt ?? null,
            ),
            customBackgroundDarkness,
            homeTo: navigation.state.homeTo,
            navigationSubtitle: navigation.state.subtitle,
            visibleNavItems: navigation.state.visibleNavItems,
            showMaintenanceBanner,
            millisecondsUntilMaintenance,
            pendingMaintenanceExtensionRequest:
                systemSettings?.pendingMaintenanceExtensionRequest
                    ? {
                          id: systemSettings.pendingMaintenanceExtensionRequest
                              .id,
                          user: {
                              id: systemSettings
                                  .pendingMaintenanceExtensionRequest.user.id,
                              username:
                                  systemSettings
                                      .pendingMaintenanceExtensionRequest.user
                                      .username,
                          },
                      }
                    : null,
            canManageBackups,
            isCollapsed: uiState.isCollapsed,
            isMaintenanceBannerMinimized: uiState.isMaintenanceBannerMinimized,
            shellStyle,
        },
        handler: {
            expandMaintenanceBanner,
            minimizeMaintenanceBanner,
        },
    }
}
