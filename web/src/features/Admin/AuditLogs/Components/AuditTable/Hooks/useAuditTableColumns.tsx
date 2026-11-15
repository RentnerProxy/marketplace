import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronDown, ChevronUp, GitCompare } from 'lucide-react'
import { useMemo } from 'react'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import { hasAuditJsonValue } from '@/lib/AuditLogs/auditLogValues.ts'
import { formatDate } from '@/lib/Date/date.ts'
import { createTimestampRangeFilter } from '@/lib/Table/tableFilters.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

import type { UseAuditTableColumnsParams } from '../Types/audit-table.types.ts'

const SYSTEM_ACTOR_FILTER_VALUE = 'system'

export default function useAuditTableColumns({
    expandedAuditLogId,
    onExpandedAuditLogIdChange,
}: UseAuditTableColumnsParams) {
    const { language, t } = useTranslationStore()

    return useMemo<Array<ColumnDef<ClientTableFeatures, AuditLogEntry>>>(
        () => [
            {
                accessorKey: 'action',
                header: t('admin.auditLogs.action', { lng: language }),
                filterFn: filterFn_equalsString,
                size: 180,
                minSize: 160,
                maxSize: 220,
                cell: ({ row }) => (
                    <span className="inline-flex max-w-full rounded-sm border border-border-dark bg-input-dark px-2.5 py-1 text-xs font-medium leading-snug text-secondary-text">
                        <span className="break-all">{row.original.action}</span>
                    </span>
                ),
            },
            {
                id: 'actorUsername',
                accessorFn: (auditLog) =>
                    auditLog.actorUsername ?? SYSTEM_ACTOR_FILTER_VALUE,
                header: t('admin.auditLogs.user'),
                size: 170,
                minSize: 150,
                maxSize: 220,
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-white">
                            {row.original.actorUsername ??
                                t('admin.auditLogs.system')}
                        </span>

                        {row.original.actorUserId && (
                            <span className="truncate text-xs text-secondary-text">
                                {row.original.actorUserId}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'message',
                header: t('admin.auditLogs.message'),
                size: 280,
                minSize: 180,
                maxSize: 360,
                cell: ({ row }) => (
                    <span className="block w-full truncate text-secondary-text">
                        {row.original.message ?? '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'method',
                header: t('admin.auditLogs.method'),
                filterFn: filterFn_equalsString,
                size: 90,
                minSize: 80,
                maxSize: 110,
                cell: ({ row }) => (
                    <span className="block truncate text-secondary-text">
                        {row.original.method ?? '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'route',
                header: t('admin.auditLogs.route'),
                size: 260,
                minSize: 180,
                maxSize: 360,
                cell: ({ row }) => (
                    <span className="block w-full truncate font-mono text-xs text-secondary-text">
                        {row.original.route ?? '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.auditLogs.created'),
                filterFn: createTimestampRangeFilter<AuditLogEntry>(),
                size: 160,
                minSize: 150,
                maxSize: 190,
                cell: ({ row }) => (
                    <span className="block truncate text-secondary-text">
                        {formatDate(row.original.createdAt)}
                    </span>
                ),
            },
            {
                id: 'details',
                header: t('admin.auditLogs.details'),
                enableSorting: false,
                enableColumnFilter: false,
                size: 120,
                minSize: 120,
                maxSize: 120,
                cell: ({ row }) => {
                    const hasDetails =
                        hasAuditJsonValue(row.original.oldValues) ||
                        hasAuditJsonValue(row.original.newValues)

                    const isExpanded = expandedAuditLogId === row.original.id

                    return (
                        <button
                            type="button"
                            disabled={!hasDetails}
                            onClick={() =>
                                onExpandedAuditLogIdChange(
                                    isExpanded ? null : row.original.id,
                                )
                            }
                            className="mx-auto flex h-9 w-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={t('admin.auditLogs.showDetails')}
                        >
                            <GitCompare className="h-4 w-4 shrink-0" />

                            {isExpanded ? (
                                <ChevronUp className="h-4 w-4 shrink-0" />
                            ) : (
                                <ChevronDown className="h-4 w-4 shrink-0" />
                            )}
                        </button>
                    )
                },
            },
        ],
        [expandedAuditLogId, language, onExpandedAuditLogIdChange, t],
    )
}
