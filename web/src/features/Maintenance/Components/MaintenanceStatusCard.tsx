import { Clock, Wrench } from 'lucide-react'
import type { MaintenanceStatusCardProps } from '../Types/types.ts'
import { formatNullableDate } from '@/lib/Date/date.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function MaintenanceStatusCard({
    status,
}: MaintenanceStatusCardProps) {
    const { t } = useTranslationStore()

    return (
        <div className="w-full max-w-xl rounded-lg border border-border-dark bg-surface-dark p-8">
            <div className="flex items-start gap-4">
                <HeadingIcon icon={Wrench} tone="warning" size="lg" />
                <div>
                    <h1 className="text-2xl font-bold text-white">
                        {t('maintenance.title')}
                    </h1>
                    <p className="mt-2 text-sm text-secondary-text">
                        {t('maintenance.description')}
                    </p>
                </div>
            </div>

            <div className="mt-6 grid gap-3 rounded-lg border border-border-dark bg-input-dark/60 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary-text">
                        {t('maintenance.startedAt')}
                    </span>
                    <span className="font-semibold text-white">
                        {formatNullableDate(status?.maintenanceStartsAt)}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary-text">
                        {t('common.status')}
                    </span>
                    <StatusIndicator
                        tone={
                            status?.isMaintenanceActive ? 'warning' : 'accent'
                        }
                    >
                        <Clock className="h-4 w-4" />
                        {status?.isMaintenanceActive
                            ? t('common.active')
                            : t('common.planned')}
                    </StatusIndicator>
                </div>
            </div>

            {status?.canBypassMaintenance && (
                <p className="mt-4 rounded-md border border-border-dark border-l-2 border-l-success bg-background-dark px-4 py-3 text-sm text-secondary-text">
                    {t('maintenance.bypassNotice')}
                </p>
            )}

            <p className="mt-5 text-sm text-secondary-text">
                {t('maintenance.extensionInfo')}
            </p>
        </div>
    )
}
