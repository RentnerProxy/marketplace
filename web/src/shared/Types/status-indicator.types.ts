import type { ReactNode } from 'react'

export type StatusIndicatorTone =
    'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type StatusIndicatorProps = {
    children: ReactNode
    tone?: StatusIndicatorTone
    className?: string
}
