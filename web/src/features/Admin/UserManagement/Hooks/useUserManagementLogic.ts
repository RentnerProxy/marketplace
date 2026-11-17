import { useQuery } from '@tanstack/react-query'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { getAccountManagementPermission } from '@/lib/UserManagement/accountManagementPermission.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getPermissionsHandler } from '../middleware.ts'
import type { UserManagementLogicReturn } from '../Types/user-management-logic.types.ts'
import useUserEditor from './useUserEditor.ts'
import useUserAccountActions from './useUserAccountActions.ts'
import useUserManagementRealtime from './useUserManagementRealtime.ts'

export default function useUserManagementLogic(
    accountType: AccountType,
): UserManagementLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const actorUserId = sessionData?.user?.id
    const canManageAccounts =
        Boolean(actorUserId) &&
        hasPermission(
            sessionData?.permissions,
            getAccountManagementPermission(accountType),
        )
    const permissionsQuery = useQuery({
        queryKey: [
            'admin-permissions',
            actorUserId ?? 'anonymous',
            accountType,
        ],
        enabled: canManageAccounts,
        queryFn: () => getPermissionsHandler({ data: { accountType } }),
    })
    const availablePermissions = canManageAccounts
        ? (permissionsQuery.data ?? [])
        : []
    const canManageSuperUsers = accountType === 'staff' && canManageAccounts

    useUserManagementRealtime()

    const accountActions = useUserAccountActions(
        accountType,
        canManageSuperUsers,
    )
    const userEditor = useUserEditor(accountType, canManageSuperUsers)

    return {
        state: {
            availablePermissions,
            canManageSuperUsers,
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
    }
}
