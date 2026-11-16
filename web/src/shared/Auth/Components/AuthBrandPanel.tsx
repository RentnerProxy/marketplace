import { Link } from '@tanstack/react-router'
import {
    Blocks,
    Code2,
    Compass,
    Globe2,
    Layers3,
    Network,
    ShieldCheck,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'

export default function AuthBrandPanel() {
    const { t } = useTranslationStore()

    return (
        <aside className="relative hidden min-h-svh flex-col overflow-hidden bg-[#0b2118] py-8 pl-10 pr-16 text-white lg:flex xl:pl-16 xl:pr-24 2xl:pl-20">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-64 -top-64 h-[700px] w-[700px] rounded-full border border-[#294a36]/45"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-96 -left-36 h-[800px] w-[800px] rounded-full border border-[#294a36]/35 bg-[#103223]/35"
            />

            <Link
                to="/"
                aria-label={t('auth.experience.backToMarketplace')}
                className="relative z-10 w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
                <MarketplaceLogo className="w-60 xl:w-72" sizes="288px" />
            </Link>

            <div className="relative z-10 my-auto py-6 xl:py-8">
                <div className="motion-safe:animate-[auth-brand-enter_800ms_ease-out_both]">
                    <p className="mb-4 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#a0c4ac]">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {t('auth.experience.eyebrow')}
                    </p>
                    <h2 className="max-w-2xl font-display text-[clamp(2.1rem,3.4vw,4.5rem)] leading-[1.08] tracking-tight">
                        {t('auth.experience.headline')}
                        <span className="mt-1 block text-primary">
                            {t('auth.experience.headlineAccent')}
                        </span>
                    </h2>
                    <p className="mt-5 max-w-md text-base leading-7 text-[#b2c8bc] xl:text-lg xl:leading-8">
                        {t('auth.experience.description')}
                    </p>
                </div>

                <div
                    aria-hidden="true"
                    className="relative mx-auto mt-6 h-[clamp(230px,30svh,340px)] w-full max-w-[480px] motion-safe:animate-[auth-brand-enter_1s_180ms_ease-out_both] xl:mt-8"
                >
                    <svg
                        viewBox="0 0 440 300"
                        fill="none"
                        className="absolute inset-0 h-full w-full overflow-visible"
                    >
                        <ellipse
                            cx="220"
                            cy="150"
                            rx="163"
                            ry="112"
                            stroke="#355b43"
                            strokeDasharray="3 9"
                        />
                        <ellipse
                            cx="220"
                            cy="150"
                            rx="117"
                            ry="80"
                            stroke="#294b37"
                        />
                        <path
                            d="M63 79C154 79 116 150 220 150S299 61 371 89M220 150C148 150 165 243 75 243M220 150C298 150 278 242 366 242"
                            stroke="#426e50"
                            strokeWidth="1.5"
                        />
                        <g className="origin-[220px_150px] motion-safe:animate-[auth-brand-orbit_48s_linear_infinite]">
                            <circle cx="220" cy="38" r="5" fill="#91d9a2" />
                            <circle
                                cx="220"
                                cy="38"
                                r="11"
                                stroke="#91d9a2"
                                strokeOpacity="0.25"
                            />
                            <circle cx="220" cy="262" r="3" fill="#658e70" />
                        </g>
                        <g className="origin-[220px_150px] motion-safe:animate-[auth-brand-orbit_36s_linear_infinite_reverse]">
                            <circle cx="337" cy="150" r="4" fill="#b6e8bf" />
                            <circle cx="103" cy="150" r="3" fill="#658e70" />
                        </g>
                    </svg>

                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="flex h-32 w-28 -rotate-6 flex-col items-center justify-center gap-3 rounded-[1.65rem] border border-[#c4e9cc] bg-[#d8f5dc] text-[#17472a] shadow-[0_16px_36px_-16px_#0008] motion-safe:animate-[auth-brand-drift_8s_ease-in-out_infinite] xl:h-36 xl:w-32">
                            <Blocks className="h-12 w-12" strokeWidth={1.25} />
                            <div className="flex gap-1.5">
                                <span className="h-1.5 w-5 rounded-full bg-[#4b8e5d]" />
                                <span className="h-1.5 w-1.5 rounded-full bg-[#8abd97]" />
                                <span className="h-1.5 w-1.5 rounded-full bg-[#8abd97]" />
                            </div>
                        </div>
                    </div>

                    <div className="absolute left-0 top-[11%] -rotate-6">
                        <div className="flex items-center gap-2.5 rounded-2xl border border-[#476b51] bg-[#1c3929] px-3 py-3 text-xs font-medium text-[#e0eee4] shadow-lg motion-safe:animate-[auth-brand-drift_9s_-2s_ease-in-out_infinite] xl:px-4 xl:text-sm">
                            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2d5239] text-[#b5edbf]">
                                <Compass
                                    className="h-5 w-5"
                                    strokeWidth={1.5}
                                />
                            </span>
                            {t('auth.experience.discover')}
                        </div>
                    </div>
                    <div className="absolute right-0 top-[21%] rotate-6">
                        <div className="flex items-center gap-2.5 rounded-2xl border border-[#476b51] bg-[#1c3929] px-3 py-3 text-xs font-medium text-[#e0eee4] shadow-lg motion-safe:animate-[auth-brand-drift_10s_-5s_ease-in-out_infinite] xl:px-4 xl:text-sm">
                            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2d5239] text-[#b5edbf]">
                                <Code2 className="h-5 w-5" strokeWidth={1.5} />
                            </span>
                            {t('auth.experience.build')}
                        </div>
                    </div>
                    <div className="absolute bottom-[7%] right-[4%] -rotate-3">
                        <div className="flex items-center gap-2.5 rounded-2xl border border-[#5d8065] bg-[#214631] px-3 py-3 text-xs font-medium text-[#e0eee4] shadow-lg motion-safe:animate-[auth-brand-drift_11s_-3s_ease-in-out_infinite] xl:px-4 xl:text-sm">
                            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#3d6546] text-[#c3f2cb]">
                                <Network
                                    className="h-5 w-5"
                                    strokeWidth={1.5}
                                />
                            </span>
                            {t('auth.experience.connect')}
                        </div>
                    </div>
                    <div className="absolute bottom-[12%] left-[7%] -rotate-12">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#3b6048] bg-[#142e21] text-[#93bea0] motion-safe:animate-[auth-brand-drift_12s_-7s_ease-in-out_infinite]">
                            <Globe2 className="h-6 w-6" strokeWidth={1.5} />
                        </div>
                    </div>
                    <div className="absolute right-[24%] top-[1%] rotate-12">
                        <div className="grid h-9 w-9 place-items-center rounded-xl border border-[#3b6048] bg-[#142e21] text-[#93bea0] motion-safe:animate-[auth-brand-drift_10s_-4s_ease-in-out_infinite]">
                            <ShieldCheck
                                className="h-4 w-4"
                                strokeWidth={1.5}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <p className="relative z-10 flex items-center gap-3 border-t border-white/10 pt-5 text-sm text-[#a0bcaa]">
                <Layers3
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-primary"
                />
                {t('auth.experience.community')}
            </p>
            <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 90 1000"
                preserveAspectRatio="none"
                className="marketplace-wave pointer-events-none absolute inset-y-0 right-0 h-full w-12 xl:w-20"
            >
                <path
                    d="M22 0C-12 180 70 320 28 510S0 820 32 1000H90V0Z"
                    fill="#0fb33a"
                />
                <path
                    d="M35 0C1 180 83 320 41 510S13 820 45 1000H90V0Z"
                    fill="#30ee61"
                />
                <path
                    d="M48 0C14 180 96 320 54 510S26 820 58 1000H90V0Z"
                    fill="#f7faf8"
                />
            </svg>
        </aside>
    )
}
