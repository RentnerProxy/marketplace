import { LockKeyhole, Terminal } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function EmptyServiceConsole() {
    const { t } = useTranslationStore()

    return (
        <section
            id="dashboard-service-console"
            aria-labelledby="dashboard-console-title"
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark"
        >
            <div className="flex items-center gap-3 border-b border-border-dark px-5 py-4">
                <HeadingIcon icon={Terminal} size="sm" />
                <div>
                    <h2
                        id="dashboard-console-title"
                        className="text-sm font-semibold text-foreground"
                    >
                        {t('admin.dashboard.console.emptyTitle')}
                    </h2>
                    <p className="mt-1 text-xs text-secondary-text">
                        {t('admin.dashboard.console.pendingSource')}
                    </p>
                </div>
            </div>
            <div className="flex min-h-80 flex-1 basis-80 flex-col items-center justify-center gap-3 bg-background-dark/65 px-5 py-4 text-center font-mono text-xs leading-6 text-secondary-text">
                <Terminal
                    className="h-6 w-6 text-secondary-text/50"
                    aria-hidden="true"
                />
                <p>{t('admin.dashboard.console.noSelection')}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-dark px-5 py-3 text-xs text-secondary-text">
                <span className="inline-flex items-center gap-2">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('admin.dashboard.console.readOnly')}
                </span>
                <span>
                    {t('admin.dashboard.console.entryCount', { count: 0 })}
                </span>
            </div>
        </section>
    )
}
