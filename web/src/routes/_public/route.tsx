import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { getFirstSuperUserSetupStatusHandler } from '@/features/Auth/FirstSuperUser/middleware.ts'
import { redirectPublicRouteForSetupStatus } from '@/lib/Routes/routeRedirects.ts'

export const Route = createFileRoute('/_public')({
    component: PublicRouteLayout,
    errorComponent: RouteErrorComponent,
    beforeLoad: async function ({ location }) {
        const { isRequired } = await getFirstSuperUserSetupStatusHandler()

        redirectPublicRouteForSetupStatus(isRequired, location.pathname)
    },
    loader: async function ({ context }) {
        await context.queryClient.ensureQueryData(systemSettingsQueryOptions())
    },
})

function PublicRouteLayout() {
    const isLogin = useRouterState({
        select: (state) =>
            state.matches.some((match) => match.routeId === '/_public/login'),
    })

    return isLogin ? <Outlet /> : <PublicLayout />
}
