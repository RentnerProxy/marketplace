import type {
    HeadingIconProps,
    HeadingIconSize,
    HeadingIconSizeClasses,
    HeadingIconTone,
} from '@/shared/Types/heading-icon.types.ts'

const accentClassNameByTone: Record<HeadingIconTone, string> = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
}

const sizeClassNames: Record<HeadingIconSize, HeadingIconSizeClasses> = {
    sm: {
        frame: 'h-9 w-9 rounded-md',
        icon: 'h-4 w-4',
        rail: 'w-1',
    },
    md: {
        frame: 'h-11 w-11 rounded-md',
        icon: 'h-5 w-5',
        rail: 'w-1',
    },
    lg: {
        frame: 'h-14 w-14 rounded-lg',
        icon: 'h-7 w-7',
        rail: 'w-1.5',
    },
}

export default function HeadingIcon({
    icon: Icon,
    tone = 'primary',
    size = 'md',
    className = '',
    iconClassName = '',
}: HeadingIconProps) {
    const sizeClassName = sizeClassNames[size]

    return (
        <span
            aria-hidden="true"
            className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-border-dark bg-background-dark text-foreground ${sizeClassName.frame} ${className}`}
        >
            <span
                className={`absolute inset-y-0 left-0 ${sizeClassName.rail} ${accentClassNameByTone[tone]}`}
            />
            <Icon
                className={`${sizeClassName.icon} translate-x-0.5 ${iconClassName}`}
            />
        </span>
    )
}
