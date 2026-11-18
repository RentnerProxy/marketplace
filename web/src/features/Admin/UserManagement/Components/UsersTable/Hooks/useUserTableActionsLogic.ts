import useTranslationStore from '@/language/useTranslationStore.ts'
import type {
    UserTableActionsProps,
    UserTableActionsLogicReturn,
} from '../Types/user-management-table.types.ts'

export default function useUserTableActionsLogic({
    accountType,
    user,
    canManageSuperUsers,
    canConvertAccounts,
    isDeletingUser,
    isTogglingUserActive,
    isResendingPasswordReset,
    onEditUser,
    onToggleUserActive,
    onPasswordReset,
    onDeleteUser,
    onConvertAccount,
}: UserTableActionsProps): UserTableActionsLogicReturn {
    const { t } = useTranslationStore()
    const isProtectedSuperUser = user.isSuperUser && !canManageSuperUsers
    const cannotDeactivateCurrentUser = user.isCurrentUser && user.isActive
    const cannotDeleteCurrentUser = user.isCurrentUser

    function getToggleStatusTooltip() {
        if (cannotDeactivateCurrentUser)
            return t('admin.users.deactivateSelfForbiddenShort')
        if (isProtectedSuperUser) return t('admin.users.statusForbiddenShort')
        return t(user.isActive ? 'common.deactivate' : 'common.activate')
    }

    function getPasswordResetTooltip() {
        if (!user.isActive) return t('admin.users.passwordResetInactiveShort')
        if (isProtectedSuperUser)
            return t('admin.users.passwordResetForbiddenShort')
        return t('userSettings.security.passwordReset')
    }

    function getDeleteTooltip() {
        if (cannotDeleteCurrentUser)
            return t('admin.users.deleteSelfForbiddenShort')
        if (isProtectedSuperUser) return t('admin.users.deleteForbiddenShort')
        return t('common.delete')
    }

    return {
        state: {
            isProtectedSuperUser,
            cannotDeactivateCurrentUser,
            cannotDeleteCurrentUser,
            isToggleStatusDisabled:
                isTogglingUserActive ||
                cannotDeactivateCurrentUser ||
                isProtectedSuperUser,
            isPasswordResetDisabled:
                isResendingPasswordReset ||
                isProtectedSuperUser ||
                !user.isActive,
            isDeleteDisabled:
                isDeletingUser ||
                cannotDeleteCurrentUser ||
                isProtectedSuperUser,
            showConvertAccount:
                canConvertAccounts &&
                !user.isCurrentUser &&
                !isProtectedSuperUser,
            convertAccountLabel: t(
                accountType === 'public'
                    ? 'admin.users.conversion.toStaff'
                    : 'admin.users.conversion.toPublic',
            ),
            editTooltip: isProtectedSuperUser
                ? t('admin.users.editForbiddenShort')
                : t('common.edit'),
            toggleStatusTooltip: getToggleStatusTooltip(),
            passwordResetTooltip: getPasswordResetTooltip(),
            deleteTooltip: getDeleteTooltip(),
        },
        handler: {
            handleEditUser: () => onEditUser(user),
            handleToggleUserActive: () => onToggleUserActive(user),
            handlePasswordReset: () => onPasswordReset(user),
            handleDeleteUser: () => onDeleteUser(user),
            handleConvertAccount: () => onConvertAccount(user),
        },
    }
}
