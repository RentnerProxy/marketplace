import { PROJECT_CONFIG } from '@/config/app.config.ts'
import type { MarketplaceLogoProps } from './Types/marketplace-logo.types.ts'

export default function MarketplaceLogo({ className, sizes = '280px' }: MarketplaceLogoProps) {
    return (
        <img
            src="/brand/marketplace-logo-640.webp"
            srcSet="/brand/marketplace-logo-640.webp 640w, /brand/marketplace-logo-1280.webp 1280w"
            sizes={sizes}
            alt={PROJECT_CONFIG.defaultName}
            width="2048"
            height="768"
            decoding="async"
            className={`h-auto object-contain ${className ?? ''}`}
        />
    )
}
