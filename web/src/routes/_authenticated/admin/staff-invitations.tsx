import { createFileRoute } from '@tanstack/react-router'
import StaffInvitationManagement from '@/features/Admin/StaffManagement/Components/StaffInvitationManagement/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/admin/staff-invitations')(
    {
        component: StaffInvitationManagement,
        errorComponent: RouteErrorComponent,
    },
)
