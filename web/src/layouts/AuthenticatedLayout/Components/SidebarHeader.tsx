import { Link } from '@tanstack/react-router'
import type { SidebarHeaderProps } from '../Types/authenticated-layout-component-props.types.ts'
import {
    applyImageFallback,
    DEFAULT_FAVICON_SRC,
} from '@/lib/Images/imageFallbacks.ts'

const defaultWordmark = '/brand/marketplace-logo-640.webp'

export default function SidebarHeader({
    title,
    subtitle,
    logoSrc,
    homeTo,
    onNavigate,
}: SidebarHeaderProps) {
    const usesDefaultLogo =
        logoSrc === DEFAULT_FAVICON_SRC || logoSrc === '/images/default.webp'
    const imageSrc = usesDefaultLogo ? defaultWordmark : logoSrc

    return (
        <div className="shrink-0">
            <Link
                to={homeTo}
                preload={false}
                aria-label={title}
                onClick={onNavigate}
                className="flex min-h-21 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
                <img
                    src={imageSrc}
                    alt=""
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                    onError={(event) =>
                        applyImageFallback(event, DEFAULT_FAVICON_SRC)
                    }
                    className={
                        usesDefaultLogo
                            ? 'aspect-8/3 w-full max-w-56 object-contain'
                            : 'size-20 shrink-0 object-contain'
                    }
                />
                {!usesDefaultLogo && (
                    <div className="min-w-0">
                        <p className="line-clamp-2 wrap-anywhere font-display text-xl leading-tight tracking-tight">
                            {title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/65">
                            {subtitle}
                        </p>
                    </div>
                )}
            </Link>
            <div
                className="mt-6 h-px bg-linear-to-r from-primary via-primary/65 to-transparent"
                aria-hidden="true"
            />
        </div>
    )
}
