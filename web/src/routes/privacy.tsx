import { buildMarketplacePageHead } from '@/lib/Seo/metadata.ts'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import Privacy from '@/features/Auth/Privacy/index.tsx'

export const Route = createFileRoute('/privacy')({
    head: () => buildMarketplacePageHead('/privacy'),
    component: PublicPageRoute,
    errorComponent: RouteErrorComponent,
})

function PublicPageRoute() {
    return (
        <PublicLayout>
            <div className="mx-auto flex w-full max-w-3xl items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
                <Privacy />
            </div>
        </PublicLayout>
    )
}
