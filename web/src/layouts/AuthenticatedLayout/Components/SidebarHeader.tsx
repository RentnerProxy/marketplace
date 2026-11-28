import { Link } from '@tanstack/react-router'
import type { SidebarHeaderProps } from '../Types/authenticated-layout-component-props.types.ts'
import {
    applyImageFallback,
    DEFAULT_FAVICON_SRC,
} from '@/lib/Images/imageFallbacks.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'

export default function SidebarHeader({
    title,
    subtitle,
    logoSrc,
    hasCustomLogo = false,
    homeTo,
    onNavigate,
}: SidebarHeaderProps) {
    return (
        <div className="shrink-0">
            <Link
                to={homeTo}
                preload={false}
                aria-label={title}
                onClick={onNavigate}
                className="comic-focus flex min-h-16 items-center gap-3 rounded-md"
            >
                {hasCustomLogo ? (
                    <>
                        <img
                            src={logoSrc}
                            alt=""
                            loading="eager"
                            decoding="sync"
                            fetchPriority="high"
                            onError={(event) =>
                                applyImageFallback(event, DEFAULT_FAVICON_SRC)
                            }
                            className="size-14 shrink-0 rounded-md border-2 border-ink bg-white object-contain shadow-[2px_2px_0_0_var(--color-proxy-500)]"
                        />
                        <div className="min-w-0">
                            <p className="line-clamp-2 wrap-anywhere font-display text-xl leading-tight tracking-[0.03em] text-white">
                                {title}
                            </p>
                            <p className="comic-lettering mt-0.5 truncate text-[11px] text-proxy-300">
                                {subtitle}
                            </p>
                        </div>
                    </>
                ) : (
                    <MarketplaceLogo priority />
                )}
            </Link>
            <div
                className="mt-5 border-b-[3px] border-dashed border-white/25"
                aria-hidden="true"
            />
        </div>
    )
}
