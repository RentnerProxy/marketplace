import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import AdminDashboard from '@/features/Admin/Dashboard/index.tsx'

export const Route = createFileRoute('/_authenticated/admin/dashboard')({
    component: AdminDashboard,
    errorComponent: RouteErrorComponent,
})
