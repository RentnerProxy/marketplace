import { LoaderCircle, Save } from 'lucide-react'
import type { SettingsSaveButtonProps } from '../Types/user-settings-component-props.types.ts'

const buttonClasses = {
    primary:
        'border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:hover:text-primary-hover-foreground',
    secondary:
        'border-rentner-border bg-rentner-control text-(color:--marketplace-ink-soft) enabled:hover:border-focus-ring/40 enabled:hover:text-focus-ring',
} as const

export default function SettingsSaveButton({
    children,
    disabled,
    isSaving,
    onClick,
    variant = 'primary',
}: SettingsSaveButtonProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none ${buttonClasses[variant]}`}
        >
            {isSaving ? (
                <LoaderCircle
                    aria-hidden="true"
                    className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                />
            ) : (
                <Save aria-hidden="true" className="size-4 shrink-0" />
            )}

            {children}
        </button>
    )
}
