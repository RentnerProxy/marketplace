import { createFileRoute } from '@tanstack/react-router'
import RestoreProgress from '@/features/RestoreProgress/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/update-in-progress')({
    component: RestoreProgress,
    errorComponent: RouteErrorComponent,
})
