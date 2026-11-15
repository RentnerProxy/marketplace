import { createFileRoute } from '@tanstack/react-router'
import CreateFirstSuperUserAccountPage from '@/features/Auth/FirstSuperUser/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import { getFirstSuperUserSetupStatusHandler } from '@/features/Auth/FirstSuperUser/middleware.ts'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { redirectSetupRouteForSetupStatus } from '@/lib/Routes/routeRedirects.ts'

export const Route = createFileRoute('/setup')({
    component: CreateFirstSuperUserAccountPage,
    errorComponent: RouteErrorComponent,
    beforeLoad: async function ({ location }) {
        const { isRequired } = await getFirstSuperUserSetupStatusHandler()

        redirectSetupRouteForSetupStatus(isRequired, location.pathname)
    },
    loader: async function ({ context }) {
        await context.queryClient.ensureQueryData(systemSettingsQueryOptions())
    },
})
