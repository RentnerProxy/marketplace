import { buildMarketplacePageHead } from '@/lib/Seo/metadata.ts'
import { createFileRoute } from '@tanstack/react-router'
import MarketplaceBlog from '@/features/MarketplaceBlog/index.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/blog')({
    head: () => buildMarketplacePageHead('/blog'),
    component: MarketplaceBlogRoute,
})

function MarketplaceBlogRoute() {
    return (
        <PublicLayout>
            <MarketplaceBlog />
        </PublicLayout>
    )
}
