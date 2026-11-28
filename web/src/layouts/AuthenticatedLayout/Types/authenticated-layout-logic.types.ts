import type { CSSProperties } from 'react'
import type {
    UserFontFamily,
    UserFontSize,
    UserThemeMode,
} from '@/lib/Theme/Types/userTheme.types.ts'
import type {
    AuthenticatedNavItem,
    AuthenticatedRoute,
} from '@/shared/Types/navigation.types.ts'

export type AuthenticatedShellUiState = {
    isCollapsed: boolean
    isMaintenanceBannerMinimized: boolean
    openGroups: Record<string, boolean>
}

export type AuthenticatedShellUiStateUpdater =
    | Partial<AuthenticatedShellUiState>
    | ((
          current: AuthenticatedShellUiState,
      ) => Partial<AuthenticatedShellUiState>)

type AuthenticatedShellState = {
    userId: string | null
    username: string
    companyName: string
    systemLogoSrc: string
    hasCustomSystemLogo: boolean
    systemFaviconSrc: string
    profileImageSrc64: string
    primaryColor: string
    primaryColorHover: string
    themeMode: UserThemeMode
    fontFamily: UserFontFamily
    fontSize: UserFontSize
    homeTo: AuthenticatedRoute
    navigationSubtitle: string
    visibleNavItems: Array<AuthenticatedNavItem>
    showMaintenanceBanner: boolean
    millisecondsUntilMaintenance: number
    pendingMaintenanceExtensionRequest: {
        id: string
        user: {
            id: string
            username: string
        }
    } | null
    canManageBackups: boolean
    isCollapsed: boolean
    isMaintenanceBannerMinimized: boolean
    shellStyle: CSSProperties
}

export type AuthenticatedShellLogicReturn = {
    state: AuthenticatedShellState
    handler: {
        expandMaintenanceBanner: () => void
        minimizeMaintenanceBanner: () => void
        toggleCollapse: () => void
    }
}

export type AuthenticatedSidebarLogicReturn = {
    state: {
        isLoggingOut: boolean
        openGroups: Record<string, boolean>
    }
    handler: {
        handleLogout: () => void
        handleToggleGroup: (group: string) => void
    }
}

export type AuthenticatedPageHeaderLogicReturn = {
    state: {
        groupKey: string | null
        eyebrow: string | null
        title: string
        description: string
    }
}

export type MaintenanceBannerLogicReturn = {
    state: { isRequestingMaintenanceExtension: boolean; reason: string }
    handler: {
        handleReasonChange: (reason: string) => void
        handleRequestMaintenanceExtension: () => void
    }
}

export type MaintenanceCountdownLogicReturn = {
    state: {
        circleCircumference: number
        circleDashOffset: number
        formattedTime: string
    }
}
