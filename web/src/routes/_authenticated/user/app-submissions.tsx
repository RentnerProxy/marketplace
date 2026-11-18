import { createFileRoute, redirect } from '@tanstack/react-router'
import DeveloperSubmissions from '@/features/Marketplace/DeveloperSubmissions.tsx'
import { requireAuthenticatedRoute } from '@/lib/Routes/routeGuards.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/user/app-submissions')({
    beforeLoad: async () => {
        const session = await requireAuthenticatedRoute()
        if (!session.user || !session.canSubmitMarketplaceApps)
            throw redirect({ to: '/apps' })
        return { actorId: session.user.id }
    },
    component: () => (
        <DeveloperSubmissions userId={Route.useRouteContext().actorId} />
    ),
    errorComponent: RouteErrorComponent,
})
