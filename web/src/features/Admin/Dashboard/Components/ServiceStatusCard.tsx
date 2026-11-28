import {
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
    success: { dot: 'bg-success ring-success/15', label: 'text-success' },
    warning: { dot: 'bg-warning ring-warning/15', label: 'text-warning' },
    danger: { dot: 'bg-danger ring-danger/15', label: 'text-danger' },
} as const

export default function ServiceStatusCard({
    service,
    health,
    isSelected,
    onSelect,
}: ServiceStatusCardProps) {
    const { t } = useTranslationStore()
    const tone = toneClasses[statusTones[health.status]]
    const Icon = serviceIcons[service]

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
            className={`group flex min-w-0 cursor-pointer flex-col rounded-md border-2 p-4 text-start transition-[background-color,border-color,transform,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none ${
                isSelected
                    ? 'comic-selected'
                    : 'border-border-dark bg-input-dark hover:border-primary'
            }`}
        >
            <span
                className="flex items-center justify-between"
                aria-hidden="true"
            >
                <Icon className="size-4 text-secondary-text" />
                <span className={`size-2 rounded-full ring-4 ${tone.dot}`} />
            </span>
            <span className="mt-4 wrap-anywhere text-base text-foreground">
                {t(`admin.dashboard.services.${service}`)}
            </span>
            <span className="mt-1 mb-4 text-xs leading-[1.45] text-secondary-text">
                {t(`admin.dashboard.details.${health.detail}`)}
                {health.status === 'running' &&
                health.detail === 'coreResponding'
                    ? ` · ${t('admin.dashboard.coreVersion', {
                          version: health.runtime.version,
                      })}`
                    : null}
            </span>
            <span className="mt-auto flex items-center justify-between gap-2">
                <span
                    aria-live="polite"
                    aria-atomic="true"
                    className={`text-xs font-bold ${tone.label}`}
                >
                    {t(`admin.dashboard.status.${health.status}`)}
                </span>
                <Terminal
                    className={`size-4 shrink-0 ${isSelected ? 'text-primary-text' : 'text-secondary-text group-hover:text-foreground'}`}
                    aria-hidden="true"
                />
            </span>
        </button>
    )
}
