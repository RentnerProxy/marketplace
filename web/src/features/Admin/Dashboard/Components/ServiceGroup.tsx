import useTranslationStore from '@/language/useTranslationStore.ts'
import ServiceStatusCard from './ServiceStatusCard.tsx'
import type { ServiceGroupProps } from '../Types/dashboard-component-props.types.ts'

export default function ServiceGroup({
    group,
    health,
    selectedService,
    onSelect,
}: ServiceGroupProps) {
    const { t } = useTranslationStore()
    const groupId = `dashboard-group-${group.id}`
    return (
        <div
            id={groupId}
            role="group"
            aria-labelledby={`${groupId}-heading`}
            className="flex min-w-0 flex-col gap-3"
        >
            <h3
                id={`${groupId}-heading`}
                className="text-sm font-bold text-foreground"
            >
                {t(`admin.dashboard.groups.${group.id}.title`)}
            </h3>
            <div className="grid flex-1 auto-rows-fr gap-3">
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
        </div>
    )
}
