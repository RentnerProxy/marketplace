import { PROJECT_CONFIG } from '@/config/app.config.ts'
import BlinkingHead from './BlinkingHead.tsx'
import type { MarketplaceLogoProps } from './Types/marketplace-logo.types.ts'

const LOGO_SIZE_CLASS_NAMES = {
    sm: { head: 'w-8', text: 'text-[1.45rem]', tag: 'text-[0.6rem]' },
    md: {
        head: 'w-10 sm:w-11',
        text: 'text-[1.7rem] sm:text-[1.95rem]',
        tag: 'text-[0.65rem]',
    },
    lg: {
        head: 'w-14 sm:w-16',
        text: 'text-4xl sm:text-5xl',
        tag: 'text-xs',
    },
} as const

/** Head logo next to a live-text wordmark, as on the landing page. */
export default function MarketplaceLogo({
    className = '',
    priority = false,
    showMarketplace = true,
    size = 'md',
    tone = 'light',
}: MarketplaceLogoProps) {
    const classNames = LOGO_SIZE_CLASS_NAMES[size]

    return (
        <span
            role="img"
            aria-label={PROJECT_CONFIG.defaultName}
            className={`group/logo inline-flex min-w-0 items-center gap-2.5 ${className}`}
        >
            <span className="block shrink-0 origin-bottom group-hover/logo:animate-mascot-wiggle">
                <BlinkingHead
                    className={classNames.head}
                    delay={size === 'lg' ? 2.3 : 0}
                    priority={priority}
                    size={size === 'lg' ? 'lg' : 'sm'}
                />
            </span>
            <span aria-hidden="true" className="flex min-w-0 flex-col">
                <span
                    className={`whitespace-nowrap font-display leading-none tracking-[0.03em] ${tone === 'ink' ? 'text-ink' : 'comic-title-outline'} ${classNames.text}`}
                >
                    Rentner
                    <span
                        className={
                            tone === 'ink' ? 'text-proxy-700' : 'text-proxy-400'
                        }
                    >
                        Proxy
                    </span>
                </span>
                {showMarketplace && (
                    <span
                        className={`comic-lettering mt-1 w-fit whitespace-nowrap rounded-sm px-1.5 py-px leading-tight tracking-[0.14em] ${tone === 'ink' ? 'bg-ink text-proxy-300' : 'bg-proxy-400 text-on-proxy'} ${classNames.tag}`}
                    >
                        Marketplace
                    </span>
                )}
            </span>
        </span>
    )
}
