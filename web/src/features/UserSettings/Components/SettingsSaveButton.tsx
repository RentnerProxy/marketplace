import { LoaderCircle, Save } from 'lucide-react'
import type { SettingsSaveButtonProps } from '../Types/user-settings-component-props.types.ts'

const buttonClasses = {
    primary:
        'bg-primary text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60',
    secondary:
        'border border-border-dark bg-background-dark text-secondary-text hover:text-white disabled:cursor-not-allowed disabled:opacity-60',
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
            className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors ${buttonClasses[variant]}`}
        >
            {isSaving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
                <Save className="h-4 w-4" />
            )}

            {children}
        </button>
    )
}
