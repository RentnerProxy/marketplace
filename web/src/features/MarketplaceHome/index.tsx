import { ArrowRight, PackageCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export default function MarketplaceHome() {
    const { t } = useTranslationStore()

    return (
        <div className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
            <section
                aria-labelledby="marketplace-title"
                className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16"
            >
                <div>
                    <p className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary-text">
                        <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full bg-primary"
                        />
                        {t('marketplace.status')}
                    </p>
                    <h1
                        id="marketplace-title"
                        className="max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl"
                    >
                        {t('marketplace.title')}{' '}
                        <span className="text-primary-text">RentnerProxy.</span>
                    </h1>
                    <p className="mt-6 max-w-xl text-base leading-8 text-secondary-text sm:text-lg">
                        {t('marketplace.description')}
                    </p>
                    <a
                        href={PROJECT_CONFIG.repositoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-8 inline-flex items-center gap-3 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                        {t('marketplace.followDevelopment')}
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </a>
                    <p className="mt-4 max-w-lg text-xs leading-6 text-secondary-text">
                        {t('marketplace.availability')}
                    </p>
                </div>
                <div className="relative overflow-hidden rounded-3xl border border-border-dark bg-surface-dark p-8 sm:p-12">
                    <div
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-1 bg-primary"
                    />
                    <div className="flex min-h-64 items-center justify-center sm:min-h-80">
                        <img
                            src="/rentnerproxy-logo.png"
                            alt=""
                            fetchPriority="high"
                            width="320"
                            height="320"
                            className="w-64 max-w-full object-contain sm:w-80"
                        />
                    </div>
                    <div className="mt-8 flex items-center justify-between gap-4 border-t border-border-dark pt-5">
                        <span className="text-sm font-semibold">
                            RentnerProxy Marketplace
                        </span>
                        <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-text">
                            {t('marketplace.inPreparation')}
                        </span>
                    </div>
                </div>
            </section>
            <section
                aria-labelledby="marketplace-outlook"
                className="mt-16 border-t border-border-dark pt-10 sm:mt-24"
            >
                <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                    <h2
                        id="marketplace-outlook"
                        className="text-2xl font-bold tracking-tight"
                    >
                        {t('marketplace.outlook')}
                    </h2>
                    <p className="text-sm text-secondary-text">
                        {t('marketplace.outlookNote')}
                    </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                        'monitoring',
                        'docker',
                        'loadBalancer',
                        'dns',
                        'oidc',
                        'crowdsec',
                    ].map((app) => (
                        <article
                            key={app}
                            className="rounded-2xl border border-border-dark bg-surface-dark p-6"
                        >
                            <div className="mb-5 flex items-center justify-between gap-3">
                                <PackageCheck
                                    aria-hidden="true"
                                    className="h-6 w-6 text-primary-text"
                                />
                                <span className="text-xs font-medium text-secondary-text">
                                    {t('common.planned')}
                                </span>
                            </div>
                            <h3 className="font-semibold">
                                {t(`marketplace.apps.${app}.title`)}
                            </h3>
                            <p className="mt-3 text-sm leading-7 text-secondary-text">
                                {t(`marketplace.apps.${app}.description`)}
                            </p>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    )
}
