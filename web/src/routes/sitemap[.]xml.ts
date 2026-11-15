import { createFileRoute } from '@tanstack/react-router'
import { buildMarketplaceSitemap } from '@/lib/Seo/sitemap.ts'

export const Route = createFileRoute('/sitemap.xml')({
    server: {
        handlers: {
            GET: () =>
                new Response(buildMarketplaceSitemap(), {
                    headers: {
                        'content-type': 'application/xml; charset=utf-8',
                    },
                }),
        },
    },
})
