import CreateUserPanel from './Components/CreateUserPanel.tsx'
import EditUserModal from './Components/UserEditModal/index.tsx'
import UsersTable from './Components/UsersTable/index.tsx'
import useUserManagementLogic from './Hooks/useUserManagementLogic.ts'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function UserManagement() {
    const { t } = useTranslationStore()
    const { state, handler, form } = useUserManagementLogic()

    return (
        <div className="space-y-6">
            <CreateUserPanel
                form={form}
                isCreatingUser={state.isCreatingUser}
                onSubmit={handler.handleCreateUserSubmit}
            />

            <UsersTable
                availablePermissions={state.availablePermissions}
                isDeletingUser={state.isDeletingUser}
                isTogglingUserActive={state.isTogglingUserActive}
                isResendingPasswordReset={state.isResendingPasswordReset}
                canManageSuperUsers={state.canManageSuperUsers}
                onPasswordReset={handler.onPasswordReset}
                onEditUser={handler.handleOpenEditModal}
                onDeleteUser={handler.handleDeleteUser}
                onToggleUserActive={handler.handleToggleUserActive}
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
        </div>
    )
}
