import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/language/translation.ts'

export type UserSettingsTab = 'account' | 'appearance' | 'security'

export type UserSettingsTabConfig = {
    key: UserSettingsTab
    labelKey: TranslationKey
    icon: LucideIcon
}

export type AuthenticatedSessionUser = NonNullable<
    AuthenticatedSessionQueryData['user']
>
