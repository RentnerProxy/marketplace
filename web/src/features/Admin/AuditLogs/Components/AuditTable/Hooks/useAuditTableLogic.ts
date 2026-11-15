import { useMemo, useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import { createSortedUniqueFilterOptions } from '@/lib/Table/tableFilters.ts'
import useAuditTableColumns from './useAuditTableColumns.tsx'
import type {
    AuditTableProps,
    AuditTableLogicReturn,
} from '../Types/audit-table.types.ts'

export default function useAuditTableLogic({
    auditLogs,
}: AuditTableProps): AuditTableLogicReturn {
    const [expandedAuditLogId, setExpandedAuditLogId] = useState<string | null>(
        null,
    )
    const [showColumnFilters, setShowColumnFilters] = useState(false)

    const columns = useAuditTableColumns({
        expandedAuditLogId,
        onExpandedAuditLogIdChange: setExpandedAuditLogId,
    })

    const { language, t } = useTranslationStore()

    const clientTable = useClientTable({
        data: auditLogs,
        columns,
        getRowId: (auditLog) => auditLog.id,
        initialSorting: [{ id: 'createdAt', desc: true }],
    })

    const auditRowsOptions = [
        { value: 10, label: t('admin.auditLogs.entryCount', { count: 10 }) },
        { value: 20, label: t('admin.auditLogs.entryCount', { count: 20 }) },
        { value: 50, label: t('admin.auditLogs.entryCount', { count: 50 }) },
        {
            value: 100,
            label: t('admin.auditLogs.entryCount', { count: 100 }),
        },
    ]

    const actionFilterOptions = useMemo(
        () =>
            createSortedUniqueFilterOptions(
                auditLogs.map((auditLog) => auditLog.action),
            ),
        [auditLogs],
    )

    const methodFilterOptions = useMemo(
        () =>
            createSortedUniqueFilterOptions(
                auditLogs.map((auditLog) => auditLog.method),
            ),
        [auditLogs],
    )

    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            action: {
                type: 'select',
                placeholder: t('admin.auditLogs.action', { lng: language }),
                options: actionFilterOptions,
            },
            actorUsername: {
                type: 'text',
                placeholder: t('admin.auditLogs.userFilterPlaceholder'),
            },
            message: {
                type: 'text',
                placeholder: t('admin.auditLogs.messageFilterPlaceholder'),
            },
            method: {
                type: 'select',
                placeholder: t('admin.auditLogs.method'),
                options: methodFilterOptions,
            },
            route: {
                type: 'text',
                placeholder: t('admin.auditLogs.routeFilterPlaceholder'),
            },
            createdAt: {
                type: 'dateRange',
                placeholder: t('admin.auditLogs.createdFilterPlaceholder'),
            },
        }),
        [actionFilterOptions, language, methodFilterOptions, t],
    )

    function handleToggleColumnFilters() {
        setShowColumnFilters((current) => !current)
    }

    return {
        table: clientTable.table,
        state: {
            searchInput: clientTable.state.searchInput,
            expandedAuditLogId,
            showColumnFilters,
            columnFilterConfigs,
            columnCount: columns.length,
            auditRowsOptions,
        },
        handler: {
            handleSearchInputChange:
                clientTable.handler.handleSearchInputChange,
            handleToggleColumnFilters,
        },
    }
}
