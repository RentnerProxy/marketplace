import { Database, Layers, Workflow } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import ServiceStatusCard from './ServiceStatusCard.tsx'
import type { ServiceGroupProps } from '../Types/dashboard-component-props.types.ts'

const groupIcons = {
    application: Layers,
    processing: Workflow,
    infrastructure: Database,
}

export default function ServiceGroup({
    group,
    health,
    selectedService,
    onSelect,
}: ServiceGroupProps) {
    const { t } = useTranslationStore()
    return (
        <section
            aria-labelledby={`dashboard-group-${group.id}`}
            className="min-w-0 rounded-lg border border-border-dark bg-surface-dark p-3.5 sm:p-4"
        >
            <div className="mb-4 flex items-center gap-3">
                <HeadingIcon icon={groupIcons[group.id]} size="sm" />
                <div className="min-w-0">
                    <h2
                        id={`dashboard-group-${group.id}`}
                        className="text-base font-semibold text-foreground"
                    >
                        {t(`admin.dashboard.groups.${group.id}.title`)}
                    </h2>
                    <p className="mt-0.5 text-xs leading-5 text-secondary-text">
                        {t(`admin.dashboard.groups.${group.id}.description`)}
                    </p>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                {group.services.map((service) => (
                    <ServiceStatusCard
                        key={service}
                        service={service}
                        health={health[service]}
                        isSelected={selectedService === service}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </section>
    )
}
