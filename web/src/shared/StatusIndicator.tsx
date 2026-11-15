import type {
    StatusIndicatorProps,
    StatusIndicatorTone,
} from '@/shared/Types/status-indicator.types.ts'

const dotClassNameByTone: Record<StatusIndicatorTone, string> = {
    neutral: 'bg-secondary-text',
    accent: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
}

export default function StatusIndicator({
    children,
    tone = 'neutral',
    className = '',
}: StatusIndicatorProps) {
    return (
        <span
            className={`inline-flex items-center gap-2 text-xs font-medium text-foreground ${className}`}
        >
            <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClassNameByTone[tone]}`}
            />
            {children}
        </span>
    )
}
