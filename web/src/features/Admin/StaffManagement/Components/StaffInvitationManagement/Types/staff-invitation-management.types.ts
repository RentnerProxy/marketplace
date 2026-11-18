import type { StaffInvitationSummary } from '../../../Types/staff-invitation.types.ts'
import type { StaffInvitationPermissionSelection } from '../../../Types/staff-invitations-logic.types.ts'

export type StaffInvitationActionsProps = {
    invitation: StaffInvitationSummary
    isPending: boolean
    onEdit: (invitation: StaffInvitationSummary) => void
    onResend: (invitation: StaffInvitationSummary) => void
    onToggleActive: (invitation: StaffInvitationSummary) => void
    onRevoke: (invitation: StaffInvitationSummary) => void
}

export type StaffInvitationManagementLogic = {
    state: {
        invitations: Array<StaffInvitationSummary>
        isLoading: boolean
        isLoadError: boolean
        isPending: boolean
        editTarget: StaffInvitationSummary | null
        permissionSelection: StaffInvitationPermissionSelection
        canSavePermissions: boolean
        hasPermissionConflict: boolean
        revokeTarget: StaffInvitationSummary | null
    }
    handler: {
        handleRetry: () => void
        handleEdit: StaffInvitationActionsProps['onEdit']
        handleResend: StaffInvitationActionsProps['onResend']
        handleToggleActive: StaffInvitationActionsProps['onToggleActive']
        handleAskRevoke: StaffInvitationActionsProps['onRevoke']
        handleCloseRevoke: () => void
        handleRevoke: () => void
        handleCloseEdit: () => void
        handleReloadPermissions: () => void
        handleSavePermissions: () => void
    }
}
