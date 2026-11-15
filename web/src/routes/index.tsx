import { buildMarketplacePageHead } from '@/lib/Seo/metadata.ts'
import { createFileRoute } from '@tanstack/react-router'
import MarketplaceHome from '@/features/MarketplaceHome/index.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/')({
    head: () => buildMarketplacePageHead('/'),
    component: MarketplaceHomeRoute,
})

function MarketplaceHomeRoute() {
    return (
        <PublicLayout>
            <MarketplaceHome />
        </PublicLayout>
    )
}
