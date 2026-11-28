import type { ReactNode } from 'react'

export type SettingsSaveButtonProps = {
    children: ReactNode
    disabled: boolean
    isSaving: boolean
    onClick: () => void
    variant?: 'primary' | 'secondary'
}

export type ReauthenticationInputProps = {
    disabled: boolean
    id: string
    isTotp: boolean
    onChange: (value: string) => void
    value: string
}
