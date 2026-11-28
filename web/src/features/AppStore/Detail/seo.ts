import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { marketplaceRobotsDirectives } from '@/config/seo.config.ts'

/** App pages are shareable; indexing follows the marketplace SEO allowlist. */
export function buildAppDetailHead(name: string, summary: string) {
    return {
        meta: [
            { title: `${name} · ${PROJECT_CONFIG.defaultName}` },
            { name: 'description', content: summary },
            { name: 'robots', content: marketplaceRobotsDirectives.private },
        ],
    }
}
