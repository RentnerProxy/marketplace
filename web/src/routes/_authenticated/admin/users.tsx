import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import UserManagement from '@/features/Admin/UserManagement/index.tsx'

export const Route = createFileRoute('/_authenticated/admin/users')({
    component: UserManagement,
    errorComponent: RouteErrorComponent,
})
