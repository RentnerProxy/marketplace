import { createFileRoute, redirect } from '@tanstack/react-router'
import { SubmissionQueue } from '@/features/Marketplace/Components/SubmissionQueue.tsx'
import { requireAuthenticatedRoute } from '@/lib/Routes/routeGuards.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/app-reviews')({
    beforeLoad: async () => {
        const session = await requireAuthenticatedRoute()
        if (!session.user) throw redirect({ to: '/login' })
        return { actorId: session.user.id }
    },
    component: () => (
        <SubmissionQueue
            mode="review"
            userId={Route.useRouteContext().actorId}
        />
    ),
    errorComponent: RouteErrorComponent,
})
