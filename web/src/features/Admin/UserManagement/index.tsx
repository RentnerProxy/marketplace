import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import { Repeat2 } from 'lucide-react'
import EditUserModal from './Components/UserEditModal/index.tsx'
import UsersTable from './Components/UsersTable/index.tsx'
import useUserManagementLogic from './Hooks/useUserManagementLogic.ts'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function UserManagement({
    accountType,
}: {
    accountType: AccountType
}) {
    const { t } = useTranslationStore()
    const { state, handler } = useUserManagementLogic(accountType)

    return (
        <div className="space-y-6">
            <UsersTable
                accountType={accountType}
                availablePermissions={state.availablePermissions}
                isDeletingUser={state.isDeletingUser}
                isTogglingUserActive={state.isTogglingUserActive}
                isResendingPasswordReset={state.isResendingPasswordReset}
                isConvertingAccount={state.isConvertingAccount}
                canManageSuperUsers={state.canManageSuperUsers}
                canConvertAccounts={state.canConvertAccounts}
                onPasswordReset={handler.onPasswordReset}
                onEditUser={handler.handleOpenEditModal}
                onDeleteUser={handler.handleDeleteUser}
                onToggleUserActive={handler.handleToggleUserActive}
                onConvertAccount={handler.handleAskConvertAccount}
            />

            <EditUserModal
                isOpen={state.isEditModalOpen}
                editForm={state.editForm}
                isUpdatingUser={state.isUpdatingUser}
                onClose={handler.handleCloseEditModal}
                onSubmit={handler.handleUpdateUser}
            />

            <SafeDeleteModal
                isOpen={state.deleteTargetUser !== null}
                question={
                    state.deleteTargetUser
                        ? t('admin.users.deleteQuestion', {
                              username: state.deleteTargetUser.username,
                          })
                        : ''
                }
                isConfirming={state.isDeletingUser}
                onClose={handler.handleCloseDeleteModal}
                onConfirm={handler.handleConfirmDeleteUser}
            />
            <SafeDeleteModal
                isOpen={state.conversionTarget !== null}
                title={t('admin.users.conversion.title')}
                description={t(
                    accountType === 'public'
                        ? 'admin.users.conversion.staffDescription'
                        : 'admin.users.conversion.publicDescription',
                )}
                question={t(
                    accountType === 'public'
                        ? 'admin.users.conversion.staffQuestion'
                        : 'admin.users.conversion.publicQuestion',
                    {
                        username: state.conversionTarget?.username ?? '',
                    },
                )}
                confirmLabel={t(
                    accountType === 'public'
                        ? 'admin.users.conversion.toStaff'
                        : 'admin.users.conversion.toPublic',
                )}
                confirmIcon={Repeat2}
                confirmingLabel={t('common.saving')}
                isConfirming={state.isConvertingAccount}
                onClose={handler.handleCloseConversion}
                onConfirm={handler.handleConfirmConversion}
            />
        </div>
    )
}
