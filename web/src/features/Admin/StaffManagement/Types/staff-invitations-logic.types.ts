import type { SubmitEvent } from 'react'
import type { PermissionManagementPermission } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

export type StaffInvitationPermissionSelection = {
    state: {
        permissionKeys: Array<string>
        permissions: Array<PermissionManagementPermission>
        presetId: string
        presetOptions: Array<{ value: string; label: string }>
        isLoadingPermissions: boolean
        isLoadError: boolean
        isValid: boolean
    }
    handler: {
        handleSelectPreset: (id: string) => void
        handleTogglePermission: (key: string) => void
        handleRetry: () => void
        handleResetSelection: (keys: Array<string>) => void
    }
}

export type StaffInvitationsLogic = {
    state: {
        username: string
        email: string
        permissionSelection: StaffInvitationPermissionSelection
        isSending: boolean
        canSend: boolean
    }
    setter: {
        setUsername: (value: string) => void
        setEmail: (value: string) => void
    }
    handler: {
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
    }
}

export type StaffInvitationPermissionFieldsProps = {
    selection: StaffInvitationPermissionSelection
    disabled: boolean
}
