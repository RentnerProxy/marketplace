import { createFileRoute, useRouterState } from '@tanstack/react-router'
import LoginPage from '@/features/Auth/Login/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import { getLoginRedirectReason } from '@/lib/Routes/routeRedirects.ts'

export const Route = createFileRoute('/_public/login')({
    component: RouteComponent,
    errorComponent: RouteErrorComponent,
})

function RouteComponent() {
    const hash = useRouterState({
        select: (state) => state.location.hash,
    })

    return <LoginPage redirectReason={getLoginRedirectReason(hash)} />
}
