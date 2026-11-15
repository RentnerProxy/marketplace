import {
    Activity,
    ArrowLeft,
    Boxes,
    Globe2,
    KeyRound,
    Network,
    ShieldCheck,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import CardWave from '@/shared/Brand/CardWave.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function MarketplaceApps() {
    const { t } = useTranslationStore()

    return (
        <div className="bg-marketplace-canvas text-marketplace-ink">
            <section
                aria-labelledby="catalog-title"
                className="mx-auto max-w-[1440px] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:px-12"
            >
                <header className="mb-12 max-w-3xl">
                    <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">
                        {t('marketplace.catalog.eyebrow')}
                    </p>
                    <h1
                        id="catalog-title"
                        className="font-display text-[clamp(2rem,6vw,3rem)] leading-[1.03] tracking-tight sm:text-6xl lg:text-7xl"
                    >
                        {t('marketplace.catalog.title')}
                    </h1>
                    <p className="mt-6 max-w-2xl text-base leading-8 text-[#52675d] sm:text-lg">
                        {t('marketplace.catalog.description')}
                    </p>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-[#52675d]">
                        {t('marketplace.catalog.note')}
                    </p>
                </header>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                        { id: 'monitoring', Icon: Activity, number: '01' },
                        { id: 'docker', Icon: Boxes, number: '02' },
                        { id: 'loadBalancer', Icon: Network, number: '03' },
                        { id: 'dns', Icon: Globe2, number: '04' },
                        { id: 'oidc', Icon: KeyRound, number: '05' },
                        { id: 'crowdsec', Icon: ShieldCheck, number: '06' },
                    ].map(({ id, Icon, number }) => (
                        <article
                            key={id}
                            className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-marketplace-void px-7 py-10 text-white shadow-[0_16px_40px_rgba(6,18,15,0.12)] sm:px-8 sm:py-11"
                        >
                            <CardWave />
                            <div className="mb-7 flex items-start justify-between gap-4">
                                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                                    <Icon
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </div>
                                <span
                                    aria-hidden="true"
                                    className="font-display text-3xl text-primary/25"
                                >
                                    {number}
                                </span>
                            </div>
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a3ffb8]">
                                {t('common.planned')}
                            </span>
                            <h2 className="mt-4 text-2xl tracking-tight">
                                {t(`marketplace.apps.${id}.title`)}
                            </h2>
                            <p className="mt-3 text-sm leading-7 text-[#c1d2c9]">
                                {t(`marketplace.apps.${id}.description`)}
                            </p>
                        </article>
                    ))}
                </div>
                <Link
                    to="/"
                    hash="marketplace-flow"
                    className="mt-12 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#0d6d2b] underline-offset-4 hover:underline"
                >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('marketplace.catalog.backToFlow')}
                </Link>
            </section>
        </div>
    )
}
