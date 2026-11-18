import type {
    AuthenticatedNavItem,
    AuthenticatedRoute,
} from '@/shared/Types/navigation.types.ts'
import type { ReactNode } from 'react'

export type LogoutButtonProps = {
    isCollapsed: boolean
}

export type AuthenticatedSidebarProps = {
    title: string
    subtitle: string
    logoSrc: string
    homeTo: AuthenticatedRoute
    navItems: Array<AuthenticatedNavItem>
    username: string
    userIconSrc: string
    isCollapsed: boolean
    activeGroupKey: string | null
}

export type SidebarContentProps = AuthenticatedSidebarProps & {
    isDesktop?: boolean
    onNavigate?: () => void
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
    showMaintenanceCountdown: boolean
    millisecondsUntilMaintenance: number
    onToggleCollapse: () => void
    onOpenMobileNavigation: () => void
    onExpandMaintenanceBanner: () => void
}

export type NavigationItemProps = {
    item: AuthenticatedNavItem
    navigationKey?: string
    isCollapsed: boolean
    activeGroupKey: string | null
    openGroups: Record<string, boolean>
    onToggleGroup: (group: string) => void
    onNavigate?: () => void
}

export type SidebarHeaderProps = {
    title: string
    subtitle: string
    logoSrc: string
    homeTo: AuthenticatedRoute
    isCollapsed: boolean
    onNavigate?: () => void
}

export type UserProfileButtonProps = {
    isCollapsed: boolean
    username: string
    profileImageSrc: string
    onNavigate?: () => void
}

export type MobileNavigationProps = {
    isOpen: boolean
    onClose: () => void
    sidebar: Omit<AuthenticatedSidebarProps, 'isCollapsed'>
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
