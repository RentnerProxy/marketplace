import ServiceGroup from './Components/ServiceGroup.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import ServiceConsole from './Components/ServiceConsole/index.tsx'
import EmptyServiceConsole from './Components/ServiceConsole/Components/EmptyServiceConsole.tsx'
import useDashboardLogic from './Hooks/useDashboardLogic.ts'

export default function AdminDashboard() {
    const { t } = useTranslationStore()
    const { state, handler } = useDashboardLogic()

    return (
        <div className="@container/dashboard grid min-w-0 gap-4">
            <section
                aria-labelledby="dashboard-service-status"
                className="marketplace-content-panel grid gap-6 rounded-[1.25rem] border border-border-dark bg-surface-dark p-[clamp(1.25rem,4vw,2rem)]"
            >
                <div>
                    <p className="font-mono text-[0.68rem] font-bold tracking-[0.16em] text-focus-ring uppercase">
                        {t('admin.dashboard.connections')}
                    </p>
                    <h2
                        id="dashboard-service-status"
                        className="mt-[0.6rem] font-sans text-[clamp(1.3rem,3vw,1.8rem)] font-normal tracking-[-0.025em] text-(color:--marketplace-ink-soft)"
                    >
                        {t('admin.dashboard.serviceStatus')}
                    </h2>
                    <p className="mt-[0.65rem] max-w-160 leading-[1.55] text-secondary-text">
                        {t('admin.dashboard.console.chooseService')}
                    </p>
                </div>
                <div className="grid gap-4 @2xl/dashboard:grid-cols-3">
                    {state.groups.map((group) => (
                        <ServiceGroup
                            key={group.id}
                            group={group}
                            health={state.services}
                            selectedService={state.selectedService}
                            onSelect={handler.handleSelectService}
                        />
                    ))}
                </div>
            </section>
            {state.selectedService ? (
                <ServiceConsole
                    key={state.selectedService}
                    service={state.selectedService}
                    onClose={handler.handleCloseConsole}
                />
            ) : (
                <EmptyServiceConsole />
            )}
        </div>
    )
}
