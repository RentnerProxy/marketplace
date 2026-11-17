import type { TableColumn } from '@rentnerkev/table'
import { useMemo } from 'react'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import { formatDate } from '@/lib/Date/date.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

const SYSTEM_ACTOR_FILTER_VALUE = 'system'

function sortedFilterOptions(values: Array<string | null>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
        .toSorted()
        .map((value) => ({ value, label: value }))
}

export default function useAuditTableColumns(auditLogs: Array<AuditLogEntry>) {
    const { language, t } = useTranslationStore()

    return useMemo<Array<TableColumn<AuditLogEntry>>>(
        () => [
            {
                accessorKey: 'action',
                header: t('admin.auditLogs.action', { lng: language }),
                enableHiding: false,
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('admin.auditLogs.action'),
                        options: sortedFilterOptions(
                            auditLogs.map((entry) => entry.action),
                        ),
                    },
                },
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
                enableHiding: false,
                meta: {
                    filter: {
                        type: 'text',
                        placeholder: t('admin.auditLogs.userFilterPlaceholder'),
                    },
                },
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
                meta: {
                    filter: {
                        type: 'text',
                        placeholder: t('admin.auditLogs.messageFilterPlaceholder'),
                    },
                },
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
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('admin.auditLogs.method'),
                        options: sortedFilterOptions(
                            auditLogs.map((entry) => entry.method),
                        ),
                    },
                },
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
                meta: {
                    filter: {
                        type: 'text',
                        placeholder: t('admin.auditLogs.routeFilterPlaceholder'),
                    },
                },
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
                meta: {
                    filter: {
                        type: 'dateRange',
                        placeholder: t('admin.auditLogs.createdFilterPlaceholder'),
                    },
                },
                size: 160,
                minSize: 150,
                maxSize: 190,
                cell: ({ row }) => (
                    <span className="block truncate text-secondary-text">
                        {formatDate(row.original.createdAt)}
                    </span>
                ),
            },
        ],
        [auditLogs, language, t],
    )
}
