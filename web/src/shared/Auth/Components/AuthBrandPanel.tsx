import { Link } from '@tanstack/react-router'
import { Layers3 } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'

export default function AuthBrandPanel() {
    const { t } = useTranslationStore()

    return (
        <aside className="relative isolate hidden min-h-svh min-w-0 flex-col overflow-hidden bg-marketplace-void py-6 pl-8 pr-14 text-white lg:flex xl:pl-12 xl:pr-20 2xl:pl-16 2xl:pr-24">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
            >
                <img
                    src="/brand/marketplace-modules-1536.webp"
                    srcSet="/brand/marketplace-modules-640.webp 640w, /brand/marketplace-modules-1536.webp 1536w"
                    sizes="50vw"
                    alt=""
                    width="1536"
                    height="1024"
                    decoding="async"
                    className="marketplace-art absolute inset-0 h-full w-full object-cover opacity-55"
                />
                <div className="marketplace-orbit absolute left-1/2 top-1/2 h-[65%] w-[145%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/[0.06]" />
                <div className="marketplace-orbit-reverse absolute left-1/2 top-1/2 h-[45%] w-[180%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-primary/10" />
            </div>

            <Link
                to="/"
                aria-label={t('auth.experience.backToMarketplace')}
                className="w-fit shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
                <MarketplaceLogo className="w-44 xl:w-48" sizes="192px" />
            </Link>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8 text-center">
                <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#a3ffb8] xl:text-xs">
                    {t('auth.experience.eyebrow')}
                </p>
                <h2 className="font-display text-[clamp(2.3rem,5.1vw,5rem)] leading-[0.91] tracking-[-0.035em]">
                    <span className="block">RentnerProxy</span>{' '}
                    <span className="relative mt-2 block text-primary">
                        Marketplace
                        <span
                            aria-hidden="true"
                            className="marketplace-spin absolute -right-4 -top-1 text-[0.35em] text-white xl:-right-6"
                        >
                            ✳
                        </span>
                    </span>
                </h2>
                <p className="mt-7 max-w-sm text-sm leading-7 text-[#b2c8bc] xl:text-base 2xl:max-w-md 2xl:text-lg">
                    {t('auth.experience.description')}
                </p>
            </div>

            <p className="flex shrink-0 items-center justify-center gap-2.5 border-t border-white/10 pt-4 text-center text-xs leading-5 text-[#a0bcaa] xl:text-sm">
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
                className="marketplace-wave pointer-events-none absolute inset-y-0 right-0 h-full w-10 xl:w-16 2xl:w-20"
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
