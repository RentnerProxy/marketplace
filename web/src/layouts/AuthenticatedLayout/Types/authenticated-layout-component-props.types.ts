import type {
    AuthenticatedNavItem,
    AuthenticatedRoute,
} from '@/shared/Types/navigation.types.ts'
import type { UserThemeMode } from '@/lib/Theme/Types/userTheme.types.ts'
import type { ReactNode } from 'react'

export type SidebarContentProps = {
    title: string
    subtitle: string
    logoSrc: string
    hasCustomLogo?: boolean
    homeTo: AuthenticatedRoute
    navItems: Array<AuthenticatedNavItem>
    username: string
    userIconSrc: string
    activeGroupKey: string | null
    onNavigate?: () => void
}

export type AuthenticatedSidebarContentProps = Omit<
    SidebarContentProps,
    'onNavigate'
>

export type AuthenticatedSidebarProps = AuthenticatedSidebarContentProps & {
    isCollapsed: boolean
}

export type AuthenticatedMainProps = {
    eyebrow: string | null
    title: string
    description: string
    children?: ReactNode
}

export type AuthenticatedTopbarProps = {
    isCollapsed: boolean
    isMobileNavigationOpen: boolean
    themeMode: UserThemeMode
    showMaintenanceCountdown: boolean
    millisecondsUntilMaintenance: number
    onToggleCollapse: () => void
    onOpenMobileNavigation: () => void
    onExpandMaintenanceBanner: () => void
}

export type NavigationItemProps = {
    item: AuthenticatedNavItem
    navigationKey?: string
    activeGroupKey: string | null
    openGroups: Record<string, boolean>
    onToggleGroup: (group: string) => void
    onNavigate?: () => void
}

export type SidebarHeaderProps = {
    title: string
    subtitle: string
    logoSrc: string
    hasCustomLogo?: boolean
    homeTo: AuthenticatedRoute
    onNavigate?: () => void
}

export type UserProfileButtonProps = {
    username: string
    profileImageSrc: string
    onNavigate?: () => void
}

export type MobileNavigationProps = {
    isOpen: boolean
    onClose: () => void
    sidebar: AuthenticatedSidebarContentProps
}

export type MaintenanceBannerProps = {
    millisecondsUntilMaintenance: number
    pendingUsername?: string
    isOwnRequestPending: boolean
    onMinimize: () => void
}

export type MaintenanceCountdownButtonProps = {
    millisecondsUntilMaintenance: number
    onExpand: () => void
}
