import { Link } from '@tanstack/react-router'
import { Layers3 } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import MascotImage from '@/shared/Brand/MascotImage.tsx'

export default function AuthBrandPanel() {
    const { t } = useTranslationStore()

    return (
        <aside className="comic-dark relative isolate hidden min-h-svh min-w-0 flex-col overflow-hidden border-r-4 border-ink py-6 pl-8 pr-12 lg:flex xl:pl-12 xl:pr-16 2xl:pl-16 2xl:pr-20">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
            >
                <div className="comic-rays absolute left-1/2 top-[58%] aspect-square w-[190%] -translate-x-1/2 -translate-y-1/2 [--rays-a:rgba(48,238,97,0.13)]" />
                <div className="comic-hatch absolute bottom-0 left-0 h-1/3 w-2/3 [--hatch-color:rgba(255,255,255,0.08)] [mask-image:linear-gradient(45deg,black,transparent_70%)]" />
            </div>
            <div
                aria-hidden="true"
                className="absolute inset-y-0 right-0 w-3 border-l-[3px] border-ink bg-proxy-400"
            />

            <Link
                to="/"
                aria-label={t('auth.experience.backToMarketplace')}
                className="comic-focus w-fit shrink-0 rounded-md"
            >
                <MarketplaceLogo priority />
            </Link>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8 text-center">
                <p className="comic-caption mb-6">
                    {t('auth.experience.eyebrow')}
                </p>
                <h2 className="comic-title text-[clamp(2.6rem,5.2vw,5.4rem)]">
                    <span className="block text-white">RentnerProxy</span>{' '}
                    <span className="mt-1 block text-proxy-400">
                        Marketplace
                    </span>
                </h2>
                <p className="mt-6 max-w-sm text-sm leading-7 text-mist-200 xl:text-base 2xl:max-w-md">
                    {t('auth.experience.description')}
                </p>
                <MascotImage
                    mascot="thumbsUp"
                    sizes="(min-width: 1536px) 15rem, 12rem"
                    className="mt-8 w-48 animate-mascot-bob motion-reduce:animate-none 2xl:w-60"
                />
            </div>

            <p className="comic-lettering flex shrink-0 items-center justify-center gap-2.5 border-t-[3px] border-dashed border-white/30 pt-4 text-center text-xs leading-5 text-mist-200 xl:text-sm">
                <Layers3
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-proxy-400"
                />
                {t('auth.experience.community')}
            </p>
        </aside>
    )
}
