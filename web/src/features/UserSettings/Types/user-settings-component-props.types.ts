import type { ReactNode } from 'react'
import type { UserSettingsTab } from './user-settings-domain.types.ts'

export type UserSettingsModalProps = {
    username: string
}

export type SettingsSaveButtonProps = {
    children: ReactNode
    disabled: boolean
    isSaving: boolean
    onClick: () => void
    variant?: 'primary' | 'secondary'
}

export type UserSettingsHeaderProps = {
    onClose: () => void
    username: string
}

export type UserSettingsTabsProps = {
    activeTab: UserSettingsTab
    onTabChange: (tab: UserSettingsTab) => void
}

export type ProfileImageSectionProps = {
    profileImageSrc: string
    userId: string
    username: string
}

export type PersonalInfoSectionProps = {
    firstName: string
    lastName: string
    street: string
    houseNumber: string
    postalCode: string
    city: string
}

export type ReauthenticationInputProps = {
    disabled: boolean
    id: string
    isTotp: boolean
    onChange: (value: string) => void
    value: string
}
