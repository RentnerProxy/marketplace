import UserManagement from '@/features/Admin/UserManagement/index.tsx'
import StaffInvitationForm from './Components/StaffInvitationForm/index.tsx'

export default function StaffManagement() {
    return (
        <div className="space-y-6">
            <StaffInvitationForm />
            <UserManagement accountType="staff" />
        </div>
    )
}
