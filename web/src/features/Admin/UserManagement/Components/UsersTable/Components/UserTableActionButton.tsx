import type { UserTableActionButtonProps } from '../Types/user-management-table.types.ts'
import { CustomTooltip } from '@rentnerkev/tooltips'

export default function UserTableActionButton({
    ariaLabel,
    children,
    className,
    disabled,
    onClick,
    tooltip,
}: UserTableActionButtonProps) {
    return (
        <CustomTooltip side="top" content={tooltip} disabledTrigger={disabled}>
            <button
                type="button"
                disabled={disabled}
                onClick={onClick}
                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
                aria-label={ariaLabel}
            >
                {children}
            </button>
        </CustomTooltip>
    )
}
