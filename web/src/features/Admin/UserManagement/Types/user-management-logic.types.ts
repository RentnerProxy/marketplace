import type {
    CreateUserForm,
    UpdateUserFormValues,
} from './user-management-form.types.ts'
import type { SubmitEvent } from 'react'

import type {
    UserManagementPermission,
    UserManagementUser,
} from './user-management-domain.types.ts'

type UserManagementState = {
    availablePermissions: Array<UserManagementPermission>
    isCreatingUser: boolean
    editForm: UpdateUserFormValues
    isEditModalOpen: boolean
    deleteTargetUser: UserManagementUser | null
    isUpdatingUser: boolean
    isDeletingUser: boolean
    isTogglingUserActive: boolean
    isLoadingPermissions: boolean
    isResendingPasswordReset: boolean
    canManageSuperUsers: boolean
}

type UserManagementHandler = {
    handleCreateUserSubmit: (event: SubmitEvent<HTMLFormElement>) => void
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
    form: CreateUserForm
}

export type UseCreateUserFormParams = {
    onCreateResponse: () => void
}
