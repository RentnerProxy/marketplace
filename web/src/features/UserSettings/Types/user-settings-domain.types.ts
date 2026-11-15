import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { LucideIcon } from 'lucide-react'

export type UserSettingsTab = 'account' | 'appearance' | 'security'

export type UserSettingsTabConfig = {
    key: UserSettingsTab
    labelKey: string
    icon: LucideIcon
}

export type AuthenticatedSessionUser = NonNullable<
    AuthenticatedSessionQueryData['user']
>
