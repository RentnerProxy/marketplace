import type { UpdateUserFormValues } from './user-management-form.types.ts'

import type {
    UserManagementPermission,
    UserManagementUser,
} from './user-management-domain.types.ts'

type UserManagementState = {
    availablePermissions: Array<UserManagementPermission>
    editForm: UpdateUserFormValues
    isEditModalOpen: boolean
    deleteTargetUser: UserManagementUser | null
    isUpdatingUser: boolean
    isDeletingUser: boolean
    isTogglingUserActive: boolean
    isResendingPasswordReset: boolean
    canManageSuperUsers: boolean
}

type UserManagementHandler = {
    handleOpenEditModal: (user: UserManagementUser) => void
    handleCloseEditModal: () => void
    handleUpdateUser: (values: UpdateUserFormValues) => void
    handleDeleteUser: (user: UserManagementUser) => void
    handleCloseDeleteModal: () => void
    handleConfirmDeleteUser: () => void
    handleToggleUserActive: (user: UserManagementUser) => void
    onPasswordReset: (user: UserManagementUser) => void
}

export type UserManagementLogicReturn = {
    state: UserManagementState
    handler: UserManagementHandler
}
