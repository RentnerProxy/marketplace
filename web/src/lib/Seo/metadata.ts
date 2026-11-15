import { PROJECT_CONFIG } from '@/config/app.config.ts'
import {
    marketplacePublicOrigin,
    marketplaceRobotsDirectives,
    marketplaceSeoPages,
} from '@/config/seo.config.ts'
import type { MarketplaceSeoPage } from './Types/seo.types.ts'

export function marketplaceCanonicalUrl(path: string): string {
    const { pathname } = new URL(path, marketplacePublicOrigin)
    return `${marketplacePublicOrigin}${pathname}`
}

export function buildMarketplaceHead(
    page: MarketplaceSeoPage,
    article = false,
) {
    const canonical = marketplaceCanonicalUrl(page.path)
    const image = marketplaceCanonicalUrl('/brand/marketplace-logo-1280.webp')
    return {
        meta: [
            { title: page.title },
            { name: 'description', content: page.description },
            { name: 'robots', content: marketplaceRobotsDirectives.public },
            { property: 'og:type', content: article ? 'article' : 'website' },
            { property: 'og:site_name', content: PROJECT_CONFIG.defaultName },
            { property: 'og:title', content: page.title },
            { property: 'og:description', content: page.description },
            { property: 'og:url', content: canonical },
            { property: 'og:image', content: image },
            { property: 'og:image:type', content: 'image/webp' },
            { property: 'og:image:width', content: '1280' },
            { property: 'og:image:height', content: '480' },
            { property: 'og:image:alt', content: PROJECT_CONFIG.defaultName },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: page.title },
            { name: 'twitter:description', content: page.description },
            { name: 'twitter:image', content: image },
            { name: 'twitter:image:alt', content: PROJECT_CONFIG.defaultName },
        ],
        links: [{ rel: 'canonical', href: canonical }],
    }
}

export function buildMarketplacePageHead(path: string) {
    const pathname = new URL(path, marketplacePublicOrigin).pathname
    const page = marketplaceSeoPages.find((entry) => entry.path === pathname)
    if (!page) throw new Error('Unknown public Marketplace page')
    return buildMarketplaceHead(page)
}
