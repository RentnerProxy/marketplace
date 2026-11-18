import type { LinkProps } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '@/shared/Types/config.types.ts'

export type AuthenticatedRoute = NonNullable<LinkProps['to']>

export type AuthenticatedNavItem = {
    labelKey: string
    icon: LucideIcon
    to?: AuthenticatedRoute
    permission?: PermissionKey
    requiresVerifiedDeveloper?: boolean
    title?: string
    description?: string
    children?: Array<AuthenticatedNavItem>
}
