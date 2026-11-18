import { createFileRoute, redirect } from '@tanstack/react-router'
import OfficialApps from '@/features/Marketplace/OfficialApps.tsx'
import { requireAuthenticatedRoute } from '@/lib/Routes/routeGuards.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/app-namespaces')({
    beforeLoad: async () => {
        const session = await requireAuthenticatedRoute()
        if (!session.user) throw redirect({ to: '/login' })
        return { actorId: session.user.id }
    },
    component: () => <OfficialApps userId={Route.useRouteContext().actorId} />,
    errorComponent: RouteErrorComponent,
})
