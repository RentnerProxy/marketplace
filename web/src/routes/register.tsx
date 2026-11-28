import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import RegisterPage, {
    RegistrationClosed,
} from '@/features/Auth/Register/index.tsx'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/register')({
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(systemSettingsQueryOptions())
    },
    component: RegisterRoute,
    errorComponent: RouteErrorComponent,
})

function RegisterRoute() {
    const { data } = useQuery(systemSettingsQueryOptions())
    return data?.isPublicRegistrationEnabled ? (
        <RegisterPage />
    ) : (
        <RegistrationClosed />
    )
}
