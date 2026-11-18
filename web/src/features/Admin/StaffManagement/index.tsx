import UserManagement from '@/features/Admin/UserManagement/index.tsx'
import StaffInvitations from './Components/StaffInvitations/index.tsx'

export default function StaffManagement() {
    return (
        <div className="space-y-6">
            <StaffInvitations />
            <UserManagement accountType="staff" />
        </div>
    )
}
