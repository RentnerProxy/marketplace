import { buildMarketplacePageHead } from '@/lib/Seo/metadata.ts'
import { createFileRoute } from '@tanstack/react-router'
import MarketplaceApps from '@/features/MarketplaceApps/index.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/apps')({
    head: () => buildMarketplacePageHead('/apps'),
    component: MarketplaceAppsRoute,
})

function MarketplaceAppsRoute() {
    return (
        <PublicLayout>
            <MarketplaceApps />
        </PublicLayout>
    )
}
