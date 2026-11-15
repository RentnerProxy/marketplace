import { createFileRoute } from '@tanstack/react-router'
import PermissionManagementPage from '@/features/Admin/PermissionManagement/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/permissions')({
    component: PermissionManagementPage,
    errorComponent: RouteErrorComponent,
})
