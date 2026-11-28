import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatFileSize } from '@/lib/Format/format.ts'
import type { RestoreProgressCardProps } from '../Types/restore-progress.types.ts'
import useRestoreProgressCardLogic from '../Hooks/useRestoreProgressCardLogic.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function RestoreProgressCard({
    restoreStatus,
    isLoading,
    isError,
}: RestoreProgressCardProps) {
    const { t } = useTranslationStore()
    const { state } = useRestoreProgressCardLogic({
        restoreStatus,
        isLoading,
        isError,
    })

    return (
        <section className="w-full max-w-2xl rounded-lg border border-border-dark bg-surface-dark p-6 sm:p-9">
            <div className="flex items-start gap-4">
                <HeadingIcon
                    icon={state.headerIcon}
                    tone={state.headerIconTone}
                    size="lg"
                    iconClassName={
                        restoreStatus?.phase === 'rolling-back'
                            ? 'animate-spin'
                            : ''
                    }
                />

                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-white">
                        {state.isRecoveryRequired
                            ? t('restoreProgress.recoveryRequiredTitle')
                            : t('restoreProgress.title')}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-secondary-text">
                        {state.isRecoveryRequired
                            ? t('restoreProgress.recoveryRequiredDescription')
                            : t('restoreProgress.description')}
                    </p>
                </div>
            </div>

            <div className="mt-8 rounded-xl border border-border-dark bg-input-dark/60 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">
                        {state.statusLabel}
                    </span>
                    {state.hasExactPercent && (
                        <span className="font-mono text-sm font-bold text-primary">
                            {Math.round(state.safePercent)}%
                        </span>
                    )}
                </div>

                <div
                    role="progressbar"
                    aria-label={state.phaseLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                        state.hasExactPercent
                            ? Math.round(state.safePercent)
                            : undefined
                    }
                    className="mt-4 h-2.5 overflow-hidden rounded-full bg-background-dark"
                >
                    <div
                        className={state.progressClassName}
                        style={state.progressStyle}
                    />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary-text">
                    <span>{state.phaseLabel}</span>
                    {restoreStatus && restoreStatus.totalBytes > 0 && (
                        <span className="font-mono">
                            {t('restoreProgress.bytes', {
                                processed: formatFileSize(
                                    restoreStatus.processedBytes,
                                ),
                                total: formatFileSize(restoreStatus.totalBytes),
                            })}
                        </span>
                    )}
                </div>
            </div>

            {isError && (
                <p className="comic-notice mt-5 bg-background-dark px-4 py-3 text-sm text-secondary-text [--notice-tone:var(--color-warning)]">
                    {t('restoreProgress.statusUnavailable')}
                </p>
            )}

            <p
                className={`comic-notice mt-5 bg-background-dark px-4 py-3 text-sm leading-6 ${state.noticeClassName}`}
            >
                {state.notice}
            </p>
        </section>
    )
}
