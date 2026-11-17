import { createFileRoute } from '@tanstack/react-router'
import PublicAccountDefaultsPage from '@/features/Admin/PublicAccountDefaults/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/user-defaults')({
    component: PublicAccountDefaultsPage,
    errorComponent: RouteErrorComponent,
})
