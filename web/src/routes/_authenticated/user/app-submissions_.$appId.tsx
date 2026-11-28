import { createFileRoute, notFound } from '@tanstack/react-router'
import StoreEditorPage from '@/features/AppStore/Editor/index.tsx'
import { storeAppInputSchema } from '@/features/AppStore/validation.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute(
    '/_authenticated/user/app-submissions_/$appId',
)({
    beforeLoad: function ({ params }) {
        if (!storeAppInputSchema.safeParse(params).success) throw notFound()
    },
    component: StoreEditorRoute,
    errorComponent: RouteErrorComponent,
})

function StoreEditorRoute() {
    const { appId } = Route.useParams()
    return <StoreEditorPage appId={appId} />
}
