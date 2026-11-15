import type { BackupStatBadgeProps } from '../Types/backup-component-props.types.ts'

export default function BackupStatBadge({
    label,
    value,
    className,
}: BackupStatBadgeProps) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
        >
            {label}
            <span className="font-mono">{value}</span>
        </span>
    )
}
