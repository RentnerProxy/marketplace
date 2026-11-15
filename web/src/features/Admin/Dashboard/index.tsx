import ServiceGroup from './Components/ServiceGroup.tsx'
import ServiceConsole from './Components/ServiceConsole/index.tsx'
import EmptyServiceConsole from './Components/ServiceConsole/Components/EmptyServiceConsole.tsx'
import useDashboardLogic from './Hooks/useDashboardLogic.ts'

export default function AdminDashboard() {
    const { state, handler } = useDashboardLogic()

    return (
        <div className="@container/dashboard flex min-w-0 flex-1 flex-col gap-4">
            <div className="grid gap-4 @5xl/dashboard:grid-cols-3">
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
