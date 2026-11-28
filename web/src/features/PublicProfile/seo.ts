import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { marketplaceRobotsDirectives } from '@/config/seo.config.ts'

/** Profiles are shareable but stay out of search indexes. */
export function buildPublicProfileHead(username: string) {
    return {
        meta: [
            { title: `${username} · ${PROJECT_CONFIG.defaultName}` },
            {
                name: 'description',
                content: `${username} · ${PROJECT_CONFIG.defaultName}`,
            },
            { name: 'robots', content: marketplaceRobotsDirectives.private },
        ],
    }
}
