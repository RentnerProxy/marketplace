import type { ErrorComponentProps } from '@tanstack/react-router'
import {
    AlertTriangle,
    Check,
    ChevronDown,
    Copy,
    FileCode,
    RefreshCcw,
    RotateCcw,
} from 'lucide-react'

import useTranslationStore from '@/language/useTranslationStore.ts'
import useRouteErrorLogic from '@/shared/RouteErrorComponent/Hooks/useRouteErrorLogic.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export function RouteErrorComponent(props: ErrorComponentProps) {
    const { t } = useTranslationStore()
    const { handler, setter, state } = useRouteErrorLogic(props)
    const { details } = state

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background-dark/80 p-4 sm:p-6">
            <div className="my-auto w-full max-w-5xl overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl shadow-black/30">
                <div className="flex items-start gap-3 border-b border-border-dark px-5 py-4 sm:px-6">
                    <HeadingIcon icon={AlertTriangle} tone="danger" />
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-white">
                            {t('shared.routeError.title')}
                        </h1>
                        <p className="mt-1 text-sm leading-relaxed text-secondary-text">
                            {t(
                                `shared.routeError.descriptions.${details.category}`,
                            )}
                        </p>
                    </div>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                    <section className="rounded-lg border border-border-dark bg-input-dark p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-secondary-text">
                            <span>{details.errorName}</span>
                            {details.statusCode && (
                                <span className="rounded-sm border border-border-dark bg-background-dark px-2 py-1 text-danger">
                                    HTTP {details.statusCode}
                                </span>
                            )}
                        </div>
                        <p className="mt-3 break-words font-mono text-sm leading-relaxed text-red-300">
                            {details.message}
                        </p>
                        {details.cause && (
                            <p className="mt-3 border-t border-border-dark pt-3 text-sm text-gray-400">
                                <span className="font-semibold text-gray-300">
                                    {t('shared.routeError.cause')}:{' '}
                                </span>
                                {details.cause}
                            </p>
                        )}
                    </section>

                    {import.meta.env.DEV && (
                        <section className="overflow-hidden rounded-lg border border-border-dark">
                            <button
                                type="button"
                                onClick={() =>
                                    setter.setIsTechnicalDetailsOpen(
                                        !state.isTechnicalDetailsOpen,
                                    )
                                }
                                aria-expanded={state.isTechnicalDetailsOpen}
                                className="flex w-full cursor-pointer items-center justify-between gap-4 bg-input-dark px-4 py-3 text-left text-sm font-semibold text-gray-300 transition-colors hover:bg-background-dark/60"
                            >
                                <span className="flex items-center gap-2">
                                    <FileCode size={16} />
                                    {t('shared.routeError.technicalDetails')}
                                </span>
                                <ChevronDown
                                    size={18}
                                    className={`transition-transform ${state.isTechnicalDetailsOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {state.isTechnicalDetailsOpen && (
                                <div className="space-y-3 border-t border-border-dark bg-background-dark/50 p-4">
                                    {details.errorPath && (
                                        <div>
                                            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                                                {t(
                                                    'shared.routeError.filePath',
                                                )}
                                            </p>
                                            <p className="break-all font-mono text-xs text-gray-300">
                                                {details.errorPath}
                                            </p>
                                        </div>
                                    )}
                                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-dark bg-input-dark p-4 font-mono text-xs text-gray-500 custom-scrollbar">
                                        {details.technicalDetails}
                                    </pre>
                                    <button
                                        type="button"
                                        onClick={
                                            handler.handleCopyTechnicalDetails
                                        }
                                        className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-400 transition-colors hover:text-white"
                                    >
                                        {state.copied ? (
                                            <Check size={16} />
                                        ) : (
                                            <Copy size={16} />
                                        )}
                                        {t(
                                            state.copied
                                                ? 'shared.routeError.copied'
                                                : 'shared.routeError.copyDetails',
                                        )}
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    <div className="flex flex-col gap-3 border-t border-border-dark pt-5 sm:flex-row">
                        <button
                            type="button"
                            onClick={props.reset}
                            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-red-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-red-500 sm:w-auto"
                        >
                            <RotateCcw size={18} />
                            {t('shared.routeError.retry')}
                        </button>
                        <button
                            type="button"
                            onClick={handler.handleReload}
                            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark px-6 py-3 font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white sm:w-auto"
                        >
                            <RefreshCcw size={18} />
                            {t('shared.routeError.reload')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
