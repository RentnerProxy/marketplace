import type { LinkProps } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '@/shared/Types/config.types.ts'
import type { TranslationKey } from '@/language/translation.ts'

export type AuthenticatedRoute = NonNullable<LinkProps['to']>

export type AuthenticatedNavItem = {
    labelKey: TranslationKey
    icon: LucideIcon
    to?: AuthenticatedRoute
    permission?: PermissionKey
    requiresVerifiedDeveloper?: boolean
    title?: TranslationKey
    description?: TranslationKey
    children?: Array<AuthenticatedNavItem>
}
