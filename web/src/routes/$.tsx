import { createFileRoute } from '@tanstack/react-router'
import NotFound from '@/shared/NothingFound/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/$')({
    component: NotFound,
    errorComponent: RouteErrorComponent,
})
