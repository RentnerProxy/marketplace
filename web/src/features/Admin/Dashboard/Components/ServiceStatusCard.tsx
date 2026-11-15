import {
    ChevronRight,
    Cpu,
    Database,
    Layers,
    Server,
    Terminal,
    Workflow,
    Radio,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import type { ServiceStatusCardProps } from '../Types/dashboard-component-props.types.ts'
import type {
    DashboardServiceHealth,
    DashboardServiceId,
} from '../Types/dashboard-domain.types.ts'

const serviceIcons: Record<DashboardServiceId, LucideIcon> = {
    webserver: Server,
    websocket: Radio,
    worker: Workflow,
    postgresql: Database,
    valkey: Layers,
    core: Cpu,
}
const statusTones = {
    running: 'success',
    starting: 'warning',
    connecting: 'warning',
    checking: 'warning',
    down: 'danger',
    error: 'danger',
    unknown: 'warning',
} as const satisfies Record<
    DashboardServiceHealth['status'],
    'success' | 'warning' | 'danger'
>
const toneClasses = {
    success: 'border-success/30 bg-success/5 text-success',
    warning: 'border-warning/30 bg-warning/5 text-warning',
    danger: 'border-danger/30 bg-danger/5 text-danger',
} as const

export default function ServiceStatusCard({
    service,
    health,
    isSelected,
    onSelect,
}: ServiceStatusCardProps) {
    const { t } = useTranslationStore()
    const tone = statusTones[health.status]

    return (
        <button
            id={`service-console-toggle-${service}`}
            type="button"
            aria-expanded={isSelected}
            aria-controls={isSelected ? 'dashboard-service-console' : undefined}
            aria-label={t(
                `admin.dashboard.console.${isSelected ? 'closeService' : 'openService'}`,
                { service: t(`admin.dashboard.services.${service}`) },
            )}
            onClick={() => onSelect(service)}
            className={`group relative flex w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-md border border-border-dark bg-background-dark/40 px-3 py-3 text-left transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                isSelected
                    ? 'before:bg-primary'
                    : 'before:bg-transparent hover:border-secondary-text/40 hover:bg-input-dark/40'
            }`}
        >
            <HeadingIcon icon={serviceIcons[service]} tone={tone} size="sm" />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                    {t(`admin.dashboard.services.${service}`)}
                </span>
                <span
                    title={t(`admin.dashboard.details.${health.detail}`)}
                    className="mt-1 block truncate text-xs leading-5 text-secondary-text"
                >
                    {t(`admin.dashboard.details.${health.detail}`)}
                    {health.status === 'running' &&
                    health.detail === 'coreResponding' ? (
                        <span>
                            {' · '}
                            {t('admin.dashboard.coreVersion', {
                                version: health.runtime.version,
                            })}
                        </span>
                    ) : null}
                </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-2">
                <span aria-live="polite" aria-atomic="true">
                    <StatusIndicator
                        tone={tone}
                        className={`whitespace-nowrap rounded border px-2 py-1 text-[11px] ${toneClasses[tone]}`}
                    >
                        {t(`admin.dashboard.status.${health.status}`)}
                    </StatusIndicator>
                </span>
                <span
                    className={`flex items-center gap-1.5 text-xs font-medium ${isSelected ? 'text-primary' : 'text-secondary-text group-hover:text-foreground'}`}
                >
                    <Terminal className="h-3 w-3" aria-hidden="true" />
                    {t('admin.dashboard.console.shortLabel')}
                    <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${isSelected ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                    />
                </span>
            </span>
        </button>
    )
}
