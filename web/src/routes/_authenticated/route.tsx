import { createFileRoute } from '@tanstack/react-router'
import AuthenticatedShell from '@/layouts/AuthenticatedLayout/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import { requireAuthenticatedRoute } from '@/lib/Routes/routeGuards.ts'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { setAuthenticatedSessionQueryData } from '@/lib/Queries/authenticatedSessionCache.ts'

export const Route = createFileRoute('/_authenticated')({
    component: AuthenticatedShell,
    errorComponent: RouteErrorComponent,
    beforeLoad: async function ({ context, location }) {
        const session = await requireAuthenticatedRoute(location.pathname)

        setAuthenticatedSessionQueryData(context.queryClient, session)
        await context.queryClient.ensureQueryData(systemSettingsQueryOptions())
    },
})
