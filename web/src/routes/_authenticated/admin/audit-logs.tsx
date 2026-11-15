import { createFileRoute } from '@tanstack/react-router'
import AuditLogs from '@/features/Admin/AuditLogs/index.tsx'

export const Route = createFileRoute('/_authenticated/admin/audit-logs')({
    component: AuditLogs,
})
