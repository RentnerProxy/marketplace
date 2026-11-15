import type { LucideIcon } from 'lucide-react'

export type HeadingIconTone = 'primary' | 'success' | 'warning' | 'danger'
export type HeadingIconSize = 'sm' | 'md' | 'lg'

export type HeadingIconProps = {
    icon: LucideIcon
    tone?: HeadingIconTone
    size?: HeadingIconSize
    className?: string
    iconClassName?: string
}

export type HeadingIconSizeClasses = {
    frame: string
    icon: string
    rail: string
}
