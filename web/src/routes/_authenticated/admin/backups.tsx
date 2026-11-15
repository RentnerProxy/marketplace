import { createFileRoute } from '@tanstack/react-router'
import Backups from '@/features/Admin/Backups/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/backups')({
    component: Backups,
    errorComponent: RouteErrorComponent,
})
