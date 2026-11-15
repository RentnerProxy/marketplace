import { CustomTooltip } from '@rentnerkev/tooltips'
import { SlidersHorizontal } from 'lucide-react'
import type { TableFilterToggleButtonProps } from '@/shared/Table/Types/table.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function TableFilterToggleButton({
    isActive,
    onClick,
}: TableFilterToggleButtonProps) {
    const { t } = useTranslationStore()

    return (
        <CustomTooltip side="top" content={t('shared.table.columnFilters')}>
            <button
                type="button"
                onClick={onClick}
                className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors ${
                    isActive
                        ? 'border-border-dark bg-input-dark text-white shadow-[inset_3px_0_0_var(--color-primary)]'
                        : 'border-border-dark bg-input-dark text-secondary-text hover:text-white'
                }`}
                aria-label={t('shared.table.toggleColumnFilters')}
            >
                <SlidersHorizontal className="h-4 w-4" />
            </button>
        </CustomTooltip>
    )
}
