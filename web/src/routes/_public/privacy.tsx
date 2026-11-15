import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import Privacy from '@/features/Auth/Privacy/index.tsx'

export const Route = createFileRoute('/_public/privacy')({
    component: Privacy,
    errorComponent: RouteErrorComponent,
})
