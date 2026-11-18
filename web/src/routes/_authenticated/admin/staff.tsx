import { createFileRoute } from '@tanstack/react-router'
import StaffManagement from '@/features/Admin/StaffManagement/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/staff')({
    component: StaffManagement,
    errorComponent: RouteErrorComponent,
})
