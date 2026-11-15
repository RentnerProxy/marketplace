import AuditTable from './Components/AuditTable/index.tsx'
import useAuditLogic from './Hooks/useAuditLogic.ts'

export default function AuditLogs() {
    const { state } = useAuditLogic()

    return (
        <div className="space-y-6">
            <AuditTable
                auditLogs={state.auditLogs}
                isLoadingAuditLogs={state.isLoadingAuditLogs}
            />
        </div>
    )
}
