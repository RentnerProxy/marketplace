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
    return (
        <div
            id={`dashboard-group-${group.id}`}
            role="group"
            aria-label={t(`admin.dashboard.groups.${group.id}.title`)}
            className="contents"
        >
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
    )
}
