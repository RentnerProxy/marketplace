import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import Maintenance from '@/features/Maintenance/index.tsx'
import { maintenanceSearchSchema } from '@/features/Maintenance/validation.ts'

export const Route = createFileRoute('/_public/maintenance')({
    component: Maintenance,
    validateSearch: function (search) {
        return maintenanceSearchSchema.parse(search)
    },
    errorComponent: RouteErrorComponent,
})
