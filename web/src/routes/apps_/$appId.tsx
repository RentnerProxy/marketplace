import { createFileRoute, notFound } from '@tanstack/react-router'
import AppDetailPage from '@/features/AppStore/Detail/index.tsx'
import AppDetailNotFound from '@/features/AppStore/Detail/Components/AppDetailNotFound.tsx'
import { buildAppDetailHead } from '@/features/AppStore/Detail/seo.ts'
import { storeAppInputSchema } from '@/features/AppStore/validation.ts'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import { appDetailQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'

export const Route = createFileRoute('/apps_/$appId')({
    loader: async function ({ context, params }) {
        if (!storeAppInputSchema.safeParse(params).success) throw notFound()
        const app = await context.queryClient.ensureQueryData(
            appDetailQueryOptions(params.appId),
        )
        if (!app) throw notFound()
        return { appId: app.appId, name: app.name, summary: app.summary }
    },
    head: ({ loaderData }) =>
        loaderData
            ? buildAppDetailHead(loaderData.name, loaderData.summary)
            : {},
    component: AppDetailRoute,
    notFoundComponent: AppDetailNotFoundRoute,
})

function AppDetailRoute() {
    const { appId } = Route.useLoaderData()

    return (
        <PublicLayout>
            <AppDetailPage appId={appId} />
        </PublicLayout>
    )
}

function AppDetailNotFoundRoute() {
    return (
        <PublicLayout>
            <AppDetailNotFound />
        </PublicLayout>
    )
}
