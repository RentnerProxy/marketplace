import type { SubmitEvent } from 'react'
import type { PermissionManagementPermission } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

export type StaffInvitationSummary = {
    id: string
    username: string
    email: string
    expiresAt: string
}

export type StaffInvitationsLogic = {
    state: {
        username: string
        email: string
        permissionKeys: Array<string>
        permissions: Array<PermissionManagementPermission>
        presetId: string
        presetOptions: Array<{ value: string; label: string }>
        invitations: Array<StaffInvitationSummary>
        isLoadingPermissions: boolean
        isLoadingInvitations: boolean
        isLoadError: boolean
        isSending: boolean
        canSend: boolean
        revokeTarget: StaffInvitationSummary | null
        isRevoking: boolean
    }
    setter: {
        setUsername: (value: string) => void
        setEmail: (value: string) => void
    }
    handler: {
        handleSelectPreset: (id: string) => void
        handleTogglePermission: (key: string) => void
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
        handleRetry: () => void
        handleAskRevoke: (invitation: StaffInvitationSummary) => void
        handleCloseRevoke: () => void
        handleRevoke: () => void
    }
}
