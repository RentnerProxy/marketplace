import { Clock3 } from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useMaintenanceCountdownLogic from '../Hooks/useMaintenanceCountdownLogic.ts'
import type { MaintenanceCountdownButtonProps } from '../Types/authenticated-layout-component-props.types.ts'

export default function MaintenanceCountdownButton({
    millisecondsUntilMaintenance,
    onExpand,
}: MaintenanceCountdownButtonProps) {
    const { t } = useTranslationStore()
    const { state } = useMaintenanceCountdownLogic(millisecondsUntilMaintenance)

    return (
        <CustomTooltip side="bottom" content={t('maintenance.expandBanner')}>
            <button
                type="button"
                aria-label={t('maintenance.expandBanner')}
                onClick={onExpand}
                className="group flex h-12 cursor-pointer items-center gap-2 rounded-md border border-border-dark bg-input-dark px-2 pr-3 text-white transition-colors hover:bg-surface-dark"
            >
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                    <svg
                        viewBox="0 0 44 44"
                        className="absolute inset-0 h-full w-full -rotate-90"
                        aria-hidden="true"
                    >
                        <circle
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="text-border-dark"
                        />
                        <circle
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeDasharray={state.circleCircumference}
                            strokeDashoffset={state.circleDashOffset}
                            className="text-warning transition-[stroke-dashoffset] duration-1000 ease-linear"
                        />
                    </svg>
                    <Clock3 className="h-4 w-4 text-warning" />
                </span>

                <span className="flex flex-col items-start leading-none">
                    <span className="text-[10px] font-medium text-secondary-text">
                        {t('maintenance.maintenanceIn')}
                    </span>
                    <span className="mt-1 whitespace-nowrap text-xs font-bold tabular-nums">
                        {state.formattedTime}
                    </span>
                </span>
            </button>
        </CustomTooltip>
    )
}
