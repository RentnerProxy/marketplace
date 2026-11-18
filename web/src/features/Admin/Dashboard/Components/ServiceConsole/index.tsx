import {
    ArrowDown,
    CircleAlert,
    LoaderCircle,
    LockKeyhole,
    Terminal,
    X,
} from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import useServiceConsoleLogic from './Hooks/useServiceConsoleLogic.ts'
import type { ServiceConsoleProps } from './Types/service-console.types.ts'

const levelClasses = {
    info: 'text-success',
    warn: 'text-warning',
    error: 'text-danger',
} as const

export default function ServiceConsole({
    service,
    onClose,
}: ServiceConsoleProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { consoleRef, outputRef },
    } = useServiceConsoleLogic({ service })

    return (
        <section
            id="dashboard-service-console"
            ref={consoleRef}
            tabIndex={-1}
            aria-labelledby="dashboard-console-title"
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark focus:outline-none"
        >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-dark px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <HeadingIcon icon={Terminal} size="sm" />
                    <div className="min-w-0">
                        <h2
                            id="dashboard-console-title"
                            className="text-base leading-tight font-semibold tracking-tight text-foreground"
                        >
                            {t('admin.dashboard.console.title', {
                                service: t(
                                    `admin.dashboard.services.${service}`,
                                ),
                            })}
                        </h2>
                        <p className="mt-1 text-xs text-secondary-text">
                            {state.sourceLabel}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span role="status" className="mr-2">
                        <StatusIndicator
                            tone={
                                state.isUnavailable
                                    ? 'danger'
                                    : state.isLoading ||
                                        state.isHistoryIncomplete
                                      ? 'warning'
                                      : 'success'
                            }
                        >
                            {state.connectionLabel}
                        </StatusIndicator>
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('admin.dashboard.console.close')}
                        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-secondary-text transition-colors hover:bg-input-dark hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </div>

            {state.isUnavailable || state.isHistoryIncomplete ? (
                <div
                    role="status"
                    className="flex items-center gap-2 border-b border-warning/20 bg-warning/5 px-5 py-3 text-xs text-warning"
                >
                    <CircleAlert
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                    />
                    {t(
                        `admin.dashboard.console.${state.isUnavailable ? 'loadError' : 'incompleteHistory'}`,
                    )}
                </div>
            ) : null}

            <div className="relative min-h-80 flex-1 basis-80">
                <div
                    ref={outputRef}
                    onScroll={handler.handleScroll}
                    tabIndex={0}
                    role="region"
                    aria-label={t('admin.dashboard.console.output')}
                    aria-busy={state.isLoading}
                    className="absolute inset-0 overflow-auto bg-background-dark/65 px-3 py-4 font-mono text-xs leading-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-5"
                >
                    {state.entries.length ? (
                        <ol>
                            {state.entries.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="grid grid-cols-[4.5rem_3rem_minmax(0,1fr)] items-start gap-x-3 rounded-sm px-2 py-0.5 hover:bg-surface-dark/70 sm:grid-cols-[5rem_3.5rem_minmax(0,1fr)]"
                                >
                                    <time
                                        dateTime={entry.timestamp}
                                        title={entry.timestamp}
                                        className="select-text text-secondary-text/70"
                                    >
                                        {entry.time}
                                    </time>
                                    <span
                                        className={`text-[10px] font-semibold uppercase tracking-wider ${levelClasses[entry.level]}`}
                                    >
                                        {entry.level}
                                    </span>
                                    <span className="min-w-0 whitespace-pre-wrap wrap-anywhere text-foreground/90">
                                        {entry.message}
                                        {entry.contextText ? (
                                            <span className="ml-3 text-secondary-text">
                                                {entry.contextText}
                                            </span>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-4 text-center text-secondary-text">
                            {state.isLoading ? (
                                <LoaderCircle
                                    className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none"
                                    aria-hidden="true"
                                />
                            ) : (
                                <Terminal
                                    className="h-6 w-6 text-secondary-text/50"
                                    aria-hidden="true"
                                />
                            )}
                            <p>
                                {t(
                                    `admin.dashboard.console.${state.isLoading ? 'loading' : state.isUnavailable ? 'unavailable' : 'empty'}`,
                                )}
                            </p>
                        </div>
                    )}
                </div>
                {!state.isFollowing ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
                        <CustomTooltip
                            side="top"
                            content={t(
                                'admin.dashboard.console.scrollDownTooltip',
                            )}
                        >
                            <button
                                type="button"
                                onClick={handler.handleJumpToLatest}
                                aria-label={t(
                                    'admin.dashboard.console.jumpToLatest',
                                    { count: state.unreadCount },
                                )}
                                className="pointer-events-auto relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-primary/40 bg-surface-dark text-primary shadow-lg shadow-black/25 transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                            >
                                <ArrowDown
                                    aria-hidden="true"
                                    strokeWidth={2.75}
                                    className="h-5 w-5 motion-safe:animate-bounce motion-safe:[animation-duration:2s]"
                                />
                                {state.unreadCount > 0 ? (
                                    <span
                                        aria-hidden="true"
                                        className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface-dark"
                                    >
                                        {state.unreadCount}
                                    </span>
                                ) : null}
                            </button>
                        </CustomTooltip>
                    </div>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-dark px-5 py-3 text-xs text-secondary-text">
                <span className="inline-flex items-center gap-2">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('admin.dashboard.console.readOnly')}
                </span>
                <span>
                    {t('admin.dashboard.console.entryCount', {
                        count: state.entries.length,
                    })}
                </span>
            </div>
        </section>
    )
}
