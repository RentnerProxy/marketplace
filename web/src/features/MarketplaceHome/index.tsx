import { Link } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import AppLifecycle from './Components/AppLifecycle/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import MascotImage from '@/shared/Brand/MascotImage.tsx'

export default function MarketplaceHome() {
    const { t } = useTranslationStore()

    return (
        <div className="bg-marketplace-canvas text-marketplace-ink">
            <section
                aria-labelledby="marketplace-title"
                className="relative z-10 px-2 pb-4 pt-4 sm:px-4 sm:pt-6"
            >
                <div className="comic-panel comic-on-green relative isolate mx-auto w-full max-w-[1440px] bg-proxy-400 text-ink">
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 overflow-hidden rounded-[2px]"
                    >
                        <div className="comic-rays absolute left-[70%] top-1/2 aspect-square w-[180%] -translate-x-1/2 -translate-y-1/2 [--rays-a:rgba(255,255,255,0.3)] lg:w-[110%]" />
                        <div className="comic-hatch absolute bottom-0 left-0 h-1/3 w-1/2 [mask-image:linear-gradient(45deg,black,transparent_70%)]" />
                    </div>

                    <div className="grid items-center gap-8 px-5 pb-8 pt-10 sm:px-8 sm:pt-12 lg:min-h-[38rem] lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:px-12 lg:pb-12 lg:pt-10">
                        <div className="max-w-2xl">
                            <p className="comic-caption comic-caption-white">
                                {t('marketplace.heroEyebrow')}
                            </p>
                            <h1
                                id="marketplace-title"
                                className="comic-title mt-7 text-[clamp(2.9rem,7.4vw,6.4rem)]"
                            >
                                <span className="block text-ink">
                                    RentnerProxy
                                </span>{' '}
                                <span className="comic-title-outline mt-1 block">
                                    Marketplace
                                </span>
                            </h1>
                            <p className="mt-7 max-w-xl font-comic text-xl font-bold leading-snug sm:text-2xl">
                                {t('marketplace.tagline')}
                            </p>
                            <p className="mt-3 max-w-xl text-base leading-7">
                                {t('marketplace.description')}
                            </p>
                            <div className="mt-8 flex flex-wrap items-center gap-4">
                                <Link
                                    to="/apps"
                                    className="comic-btn comic-btn-ink"
                                >
                                    {t('marketplace.browseApps')}
                                    <ArrowRight
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                </Link>
                                <a
                                    href={PROJECT_CONFIG.repositoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="comic-btn comic-btn-white"
                                >
                                    {t('marketplace.followDevelopment')}
                                    <ArrowUpRight
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                </a>
                            </div>
                            <p className="mt-6 max-w-lg font-comic text-sm font-bold leading-6">
                                {t('marketplace.availability')}
                            </p>
                        </div>
                        <div className="relative mx-auto w-full max-w-[19rem] sm:max-w-[23rem] lg:max-w-[27rem]">
                            <MascotImage
                                mascot="proxyBox"
                                priority
                                sizes="(min-width: 1024px) 27rem, (min-width: 640px) 23rem, 19rem"
                                className="w-full animate-mascot-bob drop-shadow-[8px_8px_0_var(--color-ink)] motion-reduce:animate-none"
                            />
                        </div>
                    </div>
                </div>
            </section>
            <section
                id="marketplace-flow"
                aria-labelledby="marketplace-flow-title"
                className="mx-auto max-w-[1440px] scroll-mt-36 px-5 pb-24 pt-12 sm:px-8 sm:pb-32 sm:pt-16 lg:scroll-mt-28 lg:px-12"
            >
                <div className="mb-10 max-w-3xl sm:mb-12">
                    <p className="comic-caption mb-5">
                        {t('marketplace.flow.eyebrow')}
                    </p>
                    <h2
                        id="marketplace-flow-title"
                        className="comic-title text-5xl sm:text-6xl lg:text-7xl"
                    >
                        {t('marketplace.flow.title')}
                    </h2>
                    <p className="mt-5 max-w-2xl text-sm leading-7 text-steel-600 sm:text-base">
                        {t('marketplace.flow.description')}
                    </p>
                </div>
                <AppLifecycle />
            </section>
        </div>
    )
}
