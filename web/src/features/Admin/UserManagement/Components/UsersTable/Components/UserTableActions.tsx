import type { UserTableActionsProps } from '../Types/user-management-table.types.ts'

import UserTableActionButton from './UserTableActionButton.tsx'
import useUserTableActionsLogic from '../Hooks/useUserTableActionsLogic.ts'
import {
    LockKeyhole,
    Pencil,
    PlayIcon,
    Power,
    RefreshCw,
    Trash2,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function UserTableActions({
    user,
    isDeletingUser,
    isTogglingUserActive,
    isResendingPasswordReset,
    canManageSuperUsers,
    onEditUser,
    onDeleteUser,
    onToggleUserActive,
    onPasswordReset,
}: UserTableActionsProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useUserTableActionsLogic({
        user,
        isDeletingUser,
        isTogglingUserActive,
        isResendingPasswordReset,
        canManageSuperUsers,
        onEditUser,
        onDeleteUser,
        onToggleUserActive,
        onPasswordReset,
    })

    return (
        <div className="flex items-center gap-2">
            <UserTableActionButton
                tooltip={state.editTooltip}
                disabled={state.isProtectedSuperUser}
                onClick={handler.handleEditUser}
                className="hover:border-primary/40 hover:text-white"
                ariaLabel={t('admin.users.editAriaLabel')}
            >
                {state.isProtectedSuperUser ? (
                    <LockKeyhole className="h-4 w-4" />
                ) : (
                    <Pencil className="h-4 w-4" />
                )}
            </UserTableActionButton>
            <UserTableActionButton
                tooltip={state.toggleStatusTooltip}
                disabled={state.isToggleStatusDisabled}
                onClick={handler.handleToggleUserActive}
                className="hover:border-yellow-400/40 hover:text-yellow-300"
                ariaLabel={t('admin.users.toggleStatusAriaLabel')}
            >
                {state.isProtectedSuperUser ||
                state.cannotDeactivateCurrentUser ? (
                    <LockKeyhole className="h-4 w-4" />
                ) : user.isActive ? (
                    <Power className="h-4 w-4" />
                ) : (
                    <PlayIcon className="h-4 w-4" />
                )}
            </UserTableActionButton>
            <UserTableActionButton
                tooltip={state.passwordResetTooltip}
                disabled={state.isPasswordResetDisabled}
                onClick={handler.handlePasswordReset}
                className="hover:border-green-500/40 hover:text-green-300"
                ariaLabel={t('admin.users.passwordResetAriaLabel')}
            >
                <RefreshCw className="h-4 w-4" />
            </UserTableActionButton>
            <UserTableActionButton
                tooltip={state.deleteTooltip}
                disabled={state.isDeleteDisabled}
                onClick={handler.handleDeleteUser}
                className="hover:border-red-500/40 hover:text-red-300"
                ariaLabel={t('admin.users.deleteAriaLabel')}
            >
                {state.cannotDeleteCurrentUser || state.isProtectedSuperUser ? (
                    <LockKeyhole className="h-4 w-4" />
                ) : (
                    <Trash2 className="h-4 w-4" />
                )}
            </UserTableActionButton>
        </div>
    )
}
