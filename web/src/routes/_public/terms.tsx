import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import Terms from '@/features/Auth/Terms/index.tsx'

export const Route = createFileRoute('/_public/terms')({
    component: Terms,
    errorComponent: RouteErrorComponent,
})
