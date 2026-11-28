import type {
    HeadingIconProps,
    HeadingIconSize,
    HeadingIconSizeClasses,
    HeadingIconTone,
} from '@/shared/Types/heading-icon.types.ts'

const fillClassNameByTone: Record<HeadingIconTone, string> = {
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-background-dark',
    warning: 'bg-warning text-background-dark',
    danger: 'bg-danger text-background-dark',
}

const sizeClassNames: Record<HeadingIconSize, HeadingIconSizeClasses> = {
    sm: {
        frame: 'h-9 w-9',
        icon: 'h-4 w-4',
    },
    md: {
        frame: 'h-11 w-11',
        icon: 'h-5 w-5',
    },
    lg: {
        frame: 'h-14 w-14',
        icon: 'h-7 w-7',
    },
}

/** Comic icon tile: tone fill, ink outline and a hard offset shadow. */
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
            className={`relative flex shrink-0 items-center justify-center rounded-md border-2 border-ink shadow-[2px_2px_0_0_var(--app-comic-pop,var(--color-ink))] ${fillClassNameByTone[tone]} ${sizeClassName.frame} ${className}`}
        >
            <Icon className={`${sizeClassName.icon} ${iconClassName}`} />
        </span>
    )
}
