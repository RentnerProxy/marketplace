import type {
    AuthenticatedNavItem,
    AuthenticatedRoute,
} from '@/shared/Types/navigation.types.ts'

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
}

export type AuthenticatedMainProps = {
    isCollapsed: boolean
    showMaintenanceBanner: boolean
}

export type AuthenticatedTopbarProps = {
    isCollapsed: boolean
    showMaintenanceCountdown: boolean
    millisecondsUntilMaintenance: number
    onExpandMaintenanceBanner: () => void
}

export type NavigationItemProps = {
    item: AuthenticatedNavItem
    depth?: number
    navigationKey?: string
    isCollapsed: boolean
    openGroups: Record<string, boolean>
}

export type SidebarHeaderProps = {
    title: string
    subtitle: string
    logoSrc: string
    homeTo: AuthenticatedRoute
    isCollapsed: boolean
}

export type UserProfileButtonProps = {
    isCollapsed: boolean
    username: string
    profileImageSrc: string
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
