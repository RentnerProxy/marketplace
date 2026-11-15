import { Outlet, createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import { requireConfiguredPermissionRouteFromQueryClient } from '@/lib/Routes/routeGuards.ts'

export const Route = createFileRoute('/_authenticated/admin')({
    component: Outlet,
    errorComponent: RouteErrorComponent,
    beforeLoad: async function ({ context, location }) {
        await requireConfiguredPermissionRouteFromQueryClient(
            context.queryClient,
            location.pathname,
        )
    },
})
