import { useQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { getPermissionsHandler } from '../middleware.ts'
import type { UserManagementPermission } from '../Types/user-management-domain.types.ts'
import type { UserManagementLogicReturn } from '../Types/user-management-logic.types.ts'
import useCreateUserForm from './useCreateUserForm.ts'
import useUserEditor from './useUserEditor.ts'
import useUserAccountActions from './useUserAccountActions.ts'
import useUserManagementRealtime from './useUserManagementRealtime.ts'

export default function useUserManagementLogic(): UserManagementLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const actorUserId = sessionData?.user?.id
    const hasFullPermissionVisibility =
        sessionData?.permissions?.includes(PERMISSIONS.ADMIN_SUPER_USER) ??
        false
    const permissionsQuery = useQuery({
        queryKey: [
            'admin-permissions',
            actorUserId ?? 'anonymous',
            hasFullPermissionVisibility ? 'full' : 'restricted',
        ],
        enabled: Boolean(actorUserId),
        queryFn: getPermissionsHandler,
    })
    const availablePermissions = actorUserId
        ? (permissionsQuery.data ?? [])
        : []
    const canManageSuperUsers = availablePermissions.some(function (
        permission: UserManagementPermission,
    ) {
        return permission.key === PERMISSIONS.ADMIN_SUPER_USER
    })

    useUserManagementRealtime()

    const accountActions = useUserAccountActions(canManageSuperUsers)
    const createUserForm = useCreateUserForm({
        onCreateResponse: accountActions.handler.handleCloseDeleteModal,
    })
    const userEditor = useUserEditor(canManageSuperUsers)

    return {
        state: {
            availablePermissions,
            isLoadingPermissions:
                Boolean(actorUserId) && permissionsQuery.isLoading,
            canManageSuperUsers,
            isCreatingUser: createUserForm.state.isCreatingUser,
            editForm: userEditor.state.editForm,
            isEditModalOpen: userEditor.state.isEditModalOpen,
            isUpdatingUser: userEditor.state.isUpdatingUser,
            deleteTargetUser: accountActions.state.deleteTargetUser,
            isDeletingUser: accountActions.state.isDeletingUser,
            isTogglingUserActive: accountActions.state.isTogglingUserActive,
            isResendingPasswordReset:
                accountActions.state.isResendingPasswordReset,
        },
        handler: {
            handleCreateUserSubmit: createUserForm.handler.handleSubmit,
            handleOpenEditModal: userEditor.handler.handleOpenEditModal,
            handleCloseEditModal: userEditor.handler.handleCloseEditModal,
            handleUpdateUser: userEditor.handler.handleUpdateUser,
            handleDeleteUser: accountActions.handler.handleDeleteUser,
            handleCloseDeleteModal:
                accountActions.handler.handleCloseDeleteModal,
            handleConfirmDeleteUser:
                accountActions.handler.handleConfirmDeleteUser,
            handleToggleUserActive:
                accountActions.handler.handleToggleUserActive,
            onPasswordReset: accountActions.handler.onPasswordReset,
        },
        form: createUserForm.form,
    }
}
