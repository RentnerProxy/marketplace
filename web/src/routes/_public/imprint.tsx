import { createFileRoute } from '@tanstack/react-router'
import Imprint from '@/features/Auth/Imprint/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_public/imprint')({
    component: Imprint,
    errorComponent: RouteErrorComponent,
})
