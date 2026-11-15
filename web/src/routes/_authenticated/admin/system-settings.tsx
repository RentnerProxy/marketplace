import { createFileRoute } from '@tanstack/react-router'
import SystemSettings from '@/features/Admin/SystemSettings/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/system-settings')({
    component: SystemSettings,
    errorComponent: RouteErrorComponent,
})
