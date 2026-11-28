import { createFileRoute } from '@tanstack/react-router'
import PeoplePage from '@/features/People/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/people')({
    component: PeoplePage,
    errorComponent: RouteErrorComponent,
})
