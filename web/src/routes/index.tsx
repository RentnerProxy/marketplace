import { createFileRoute } from '@tanstack/react-router'
import MarketplaceHome from '@/features/MarketplaceHome/index.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/')({
    component: MarketplaceHomeRoute,
})

function MarketplaceHomeRoute() {
    return (
        <PublicLayout>
            <MarketplaceHome />
        </PublicLayout>
    )
}
