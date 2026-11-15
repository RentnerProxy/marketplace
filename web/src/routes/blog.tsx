import { createFileRoute } from '@tanstack/react-router'
import MarketplaceBlog from '@/features/MarketplaceBlog/index.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/blog')({
    component: MarketplaceBlogRoute,
})

function MarketplaceBlogRoute() {
    return (
        <PublicLayout>
            <MarketplaceBlog />
        </PublicLayout>
    )
}
