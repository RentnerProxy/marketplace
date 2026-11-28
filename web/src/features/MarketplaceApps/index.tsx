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
import AppCatalog from '@/features/AppCatalog/Components/AppCatalog.tsx'

export default function MarketplaceApps() {
    const { t } = useTranslationStore()

    return (
        <div className="bg-marketplace-canvas text-marketplace-ink">
            <section
                aria-labelledby="catalog-title"
                className="mx-auto max-w-[1440px] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:px-12"
            >
                <header className="mb-12 max-w-3xl">
                    <p className="comic-caption mb-5">
                        {t('marketplace.catalog.eyebrow')}
                    </p>
                    <h1
                        id="catalog-title"
                        className="comic-title text-[clamp(2.8rem,7vw,4rem)] sm:text-7xl lg:text-8xl"
                    >
                        {t('marketplace.catalog.title')}
                    </h1>
                    <p className="mt-6 max-w-2xl text-base leading-8 text-steel-600 sm:text-lg">
                        {t('marketplace.catalog.description')}
                    </p>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-steel-600">
                        {t('marketplace.catalog.note')}
                    </p>
                </header>
                <div className="mb-16">
                    <AppCatalog
                        hideWhenEmpty
                        title={t('appStore.catalogTitle')}
                    />
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                        [
                            { id: 'monitoring', Icon: Activity, number: '01' },
                            { id: 'docker', Icon: Boxes, number: '02' },
                            { id: 'loadBalancer', Icon: Network, number: '03' },
                            { id: 'dns', Icon: Globe2, number: '04' },
                            { id: 'oidc', Icon: KeyRound, number: '05' },
                            { id: 'crowdsec', Icon: ShieldCheck, number: '06' },
                        ] as const
                    ).map(({ id, Icon, number }) => (
                        <article
                            key={id}
                            className="comic-card comic-dark relative isolate overflow-hidden px-7 py-10 sm:px-8 sm:py-11"
                        >
                            <CardWave />
                            <div className="mb-7 flex items-start justify-between gap-4">
                                <div className="grid h-12 w-12 place-items-center rounded-md border-[3px] border-ink bg-proxy-400 text-ink shadow-[3px_3px_0_0_var(--color-proxy-500)]">
                                    <Icon
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </div>
                                <span
                                    aria-hidden="true"
                                    className="font-display text-4xl text-proxy-400/40"
                                >
                                    {number}
                                </span>
                            </div>
                            <span className="comic-chip comic-chip-ink text-[11px] uppercase">
                                {t('common.planned')}
                            </span>
                            <h2 className="comic-title mt-5 text-3xl">
                                {t(`marketplace.apps.${id}.title`)}
                            </h2>
                            <p className="mt-3 text-sm leading-7 text-mist-200">
                                {t(`marketplace.apps.${id}.description`)}
                            </p>
                        </article>
                    ))}
                </div>
                <Link
                    to="/"
                    hash="marketplace-flow"
                    className="comic-btn comic-btn-sm comic-btn-white mt-12"
                >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('marketplace.catalog.backToFlow')}
                </Link>
            </section>
        </div>
    )
}
