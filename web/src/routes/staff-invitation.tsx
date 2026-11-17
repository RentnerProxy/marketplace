import { createFileRoute } from '@tanstack/react-router'
import StaffInvitationPage from '@/features/Auth/StaffInvitation/index.tsx'

export const Route = createFileRoute('/staff-invitation')({
    component: StaffInvitationPage,
})
