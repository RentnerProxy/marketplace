import type { AuditLogDetailsProps } from '../Types/audit-table.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatDate } from '@/lib/Date/date.ts'
import useAuditLogDetailsLogic from '../Hooks/useAuditLogDetailsLogic.ts'

export function AuditLogDetails({ auditLog }: AuditLogDetailsProps) {
    const { t } = useTranslationStore()
    const { state } = useAuditLogDetailsLogic(auditLog)
    const fields = [
        { key: 'entryId', value: auditLog.id },
        { key: 'action', value: auditLog.action },
        {
            key: 'user',
            value: (
                <>
                    {auditLog.actorUsername ?? t('admin.auditLogs.system')}
                    {auditLog.actorUserId && (
                        <span className="block text-xs text-secondary-text">
                            {auditLog.actorUserId}
                        </span>
                    )}
                </>
            ),
        },
        { key: 'created', value: formatDate(auditLog.createdAt) },
        { key: 'method', value: auditLog.method ?? '—' },
        { key: 'route', value: auditLog.route ?? '—' },
        { key: 'message', value: auditLog.message ?? '—' },
    ]

    return (
        <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fields.map(({ key, value }) => (
                    <div
                        key={key}
                        className={
                            key === 'message' ? 'sm:col-span-2' : undefined
                        }
                    >
                        <dt className="text-xs font-medium text-secondary-text">
                            {t(`admin.auditLogs.${key}`)}
                        </dt>
                        <dd className="mt-1 wrap-break-word text-sm text-white">
                            {value}
                        </dd>
                    </div>
                ))}
            </dl>
            <div className="overflow-hidden rounded-lg border border-border-dark bg-surface-dark">
                {state.rows.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-secondary-text">
                        {t('admin.auditLogs.emptyDiff')}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="min-w-120">
                            <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_minmax(0,2fr)] border-b border-border-dark bg-input-dark/60 text-xs font-semibold uppercase tracking-wide text-secondary-text">
                                <div className="px-4 py-3">
                                    {t('common.field')}
                                </div>

                                <div className="border-l border-border-dark px-4 py-3 text-red-300">
                                    {t('admin.auditLogs.oldValue')}
                                </div>

                                <div className="border-l border-border-dark px-4 py-3 text-green-300">
                                    {t('admin.auditLogs.newValue')}
                                </div>
                            </div>

                            {state.rows.map((row) => (
                                <div
                                    key={row.key}
                                    className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_minmax(0,2fr)] border-b border-border-dark last:border-b-0"
                                >
                                    <div className="min-w-0 px-4 py-3 font-mono text-xs font-semibold text-white">
                                        <span className="wrap-break-word">
                                            {row.key}
                                        </span>
                                    </div>

                                    <div className="min-w-0 border-l border-border-dark bg-background-dark/50 px-4 py-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <span className="shrink-0 font-mono text-sm font-bold text-red-400">
                                                -
                                            </span>

                                            <div className="min-w-0 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-secondary-text">
                                                {row.oldValue}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="min-w-0 border-l border-border-dark bg-background-dark/50 px-4 py-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <span className="shrink-0 font-mono text-sm font-bold text-green-400">
                                                +
                                            </span>

                                            <div className="min-w-0 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-secondary-text">
                                                {row.newValue}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
