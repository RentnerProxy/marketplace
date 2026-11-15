import MaintenanceStatusCard from './Components/MaintenanceStatusCard.tsx'
import useMaintenanceLogic from './Hooks/useMaintenanceLogic.ts'

export default function Maintenance() {
    const { state } = useMaintenanceLogic()

    return <MaintenanceStatusCard status={state.status} />
}
