import { Link } from '@tanstack/react-router'
import {
    ArrowDown,
    ArrowRight,
    BadgeCheck,
    Code2,
    Download,
    PackageOpen,
    Send,
    ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useAppLifecycleLogic from './Hooks/useAppLifecycleLogic.ts'
import type { AppLifecycleId } from './Types/app-lifecycle.types.ts'

const STAGE_ICONS: Record<AppLifecycleId, LucideIcon> = {
    template: PackageOpen,
    develop: Code2,
    submit: Send,
    review: ShieldCheck,
    publish: BadgeCheck,
    install: Download,
}

export default function AppLifecycle() {
    const { t } = useTranslationStore()
    const { state, handler } = useAppLifecycleLogic()

    return (
        <div
            role="region"
            aria-labelledby="marketplace-flow-title"
            className="comic-panel comic-dark relative isolate overflow-hidden p-5 sm:p-8 lg:p-10"
        >
            <p className="comic-lettering text-xs leading-6 text-mist-300 sm:text-sm">
                {t('marketplace.flow.hint')}
            </p>
            <div className="relative mt-7 lg:mt-3">
                <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 1000 440"
                    preserveAspectRatio="none"
                    fill="none"
                    className="pointer-events-none absolute inset-0 hidden h-[440px] w-full overflow-visible lg:block"
                >
                    <defs>
                        {[
                            { kind: 'development', color: '#a0b7aa' },
                            { kind: 'review', color: '#fbbf24' },
                            { kind: 'release', color: '#30ee61' },
                        ].map(({ kind, color }) => (
                            <marker
                                key={kind}
                                id={`marketplace-flow-arrow-${kind}`}
                                markerWidth="9"
                                markerHeight="9"
                                refX="7"
                                refY="4"
                                orient="auto"
                                markerUnits="userSpaceOnUse"
                                viewBox="0 0 8 8"
                            >
                                <path
                                    d="m1 1 6 3-6 3"
                                    stroke={color}
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </marker>
                        ))}
                    </defs>
                    {state.connections.map((connection) => (
                        <g
                            key={connection.id}
                            className={
                                connection.kind === 'development'
                                    ? 'text-[#a0b7aa]'
                                    : connection.kind === 'review'
                                      ? 'text-amber-300'
                                      : 'text-primary'
                            }
                        >
                            <path
                                d={connection.path}
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray={
                                    connection.feedback ? '5 6' : undefined
                                }
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                                markerEnd={`url(#marketplace-flow-arrow-${connection.kind})`}
                                opacity={
                                    connection.from === state.activeStep.id ||
                                    connection.to === state.activeStep.id
                                        ? 0.9
                                        : 0.35
                                }
                            />
                            {(connection.from === state.activeStep.id ||
                                connection.to === state.activeStep.id) && (
                                <path
                                    d={connection.path}
                                    pathLength="1"
                                    stroke="currentColor"
                                    strokeWidth="3.5"
                                    strokeDasharray="0.12 0.88"
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
                                    className="marketplace-flow-travel"
                                />
                            )}
                        </g>
                    ))}
                </svg>
                <p className="pointer-events-none absolute left-[54%] top-[194px] hidden text-[10px] text-amber-200/70 lg:block">
                    {t('marketplace.flow.feedback')}
                </p>
                <ol className="relative grid gap-9 lg:block lg:h-[440px]">
                    {state.steps.map((step, index) => {
                        const Icon = STAGE_ICONS[step.id]
                        return (
                            <li
                                key={step.id}
                                className={`relative lg:absolute lg:w-[24%] ${step.position}`}
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        handler.handleSelectStep(step.id)
                                    }
                                    aria-pressed={
                                        state.activeStep.id === step.id
                                    }
                                    aria-controls="marketplace-flow-detail"
                                    className={`comic-focus relative flex h-32 w-full flex-col justify-center rounded-md border-[3px] px-5 py-4 text-left transition-[transform,box-shadow,border-color] motion-reduce:transition-none ${state.activeStep.id === step.id ? '-translate-x-0.5 -translate-y-0.5 border-proxy-400 bg-ink shadow-[5px_5px_0_0_var(--color-proxy-400)]' : 'border-steel-700 bg-ink/70 shadow-[3px_3px_0_0_var(--color-steel-700)] hover:border-proxy-500'}`}
                                >
                                    <span className="comic-lettering flex w-full items-center justify-between gap-2 text-[10px] leading-3 text-mist-400">
                                        <span>
                                            {t(
                                                `marketplace.flow.roles.${step.role}`,
                                            )}
                                        </span>
                                        <span
                                            aria-hidden="true"
                                            className="text-proxy-400"
                                        >
                                            {step.number}
                                        </span>
                                    </span>
                                    <span className="mt-3 flex min-w-0 items-center gap-3">
                                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-proxy-400 text-ink">
                                            <Icon
                                                aria-hidden="true"
                                                className="h-5 w-5"
                                            />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block font-display text-xl leading-5 tracking-[0.03em]">
                                                {t(
                                                    `marketplace.flow.steps.${step.id}.title`,
                                                )}
                                            </span>
                                            <span className="mt-1 block text-[11px] leading-4 text-mist-400">
                                                {t(
                                                    `marketplace.flow.steps.${step.id}.caption`,
                                                )}
                                            </span>
                                        </span>
                                    </span>
                                </button>
                                {index < state.total - 1 && (
                                    <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute left-1/2 top-full flex h-9 -translate-x-1/2 items-center justify-center text-proxy-400 lg:hidden"
                                    >
                                        <ArrowDown className="h-6 w-6" />
                                    </span>
                                )}
                            </li>
                        )
                    })}
                </ol>
            </div>
            <div className="comic-lettering flex flex-wrap gap-x-6 gap-y-3 border-t-[3px] border-dashed border-white/25 py-5 text-[10px] text-mist-300 sm:text-xs">
                <span className="inline-flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className="h-px w-5 bg-[#a0b7aa]"
                    />
                    {t('marketplace.flow.legend.development')}
                </span>
                <span className="inline-flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className="h-px w-5 bg-amber-300"
                    />
                    {t('marketplace.flow.legend.review')}
                </span>
                <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="h-px w-5 bg-primary" />
                    {t('marketplace.flow.legend.release')}
                </span>
            </div>
            <div
                id="marketplace-flow-detail"
                aria-live="polite"
                aria-atomic="true"
                className="border-t-[3px] border-dashed border-white/25 py-6 sm:grid sm:grid-cols-[1fr_2fr] sm:gap-8"
            >
                <div>
                    <p className="comic-chip comic-chip-green text-xs">
                        {t('marketplace.flow.detailLabel', {
                            number: state.activeStep.number,
                            total: state.total,
                        })}
                    </p>
                    <h3 className="comic-title mt-4 text-4xl">
                        {t(
                            `marketplace.flow.steps.${state.activeStep.id}.title`,
                        )}
                    </h3>
                </div>
                <p className="mt-4 text-sm leading-7 text-mist-200 sm:mt-0">
                    {t(
                        `marketplace.flow.steps.${state.activeStep.id}.description`,
                    )}
                </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-5 border-t-[3px] border-dashed border-white/25 pt-5">
                <p
                    role="note"
                    className="max-w-2xl text-xs leading-6 text-mist-400"
                >
                    {t('marketplace.flow.preview')}
                </p>
                <Link to="/apps" className="comic-btn comic-btn-sm">
                    {t('marketplace.flow.relatedApps')}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
            </div>
        </div>
    )
}
