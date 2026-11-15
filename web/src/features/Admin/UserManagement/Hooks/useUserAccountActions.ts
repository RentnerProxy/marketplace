import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    deleteUserHandler,
    resetUserPasswordHandler,
    setUserActiveHandler,
} from '../middleware.ts'
import type { UserManagementUser } from '../Types/user-management-domain.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import { updateUserActiveStateInList } from '@/lib/UserManagement/userCache.ts'

export default function useUserAccountActions(canManageSuperUsers: boolean) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [deleteTargetUser, setDeleteTargetUser] =
        useState<UserManagementUser | null>(null)

    const { mutate: deleteUserMutation, isPending: isDeletingUser } =
        useMutation({
            mutationFn: async function (user: UserManagementUser) {
                return await deleteUserHandler({ data: { id: user.id } })
            },
            onSuccess: async function (result) {
                if (!result.success) {
                    toastAppError(new AppError(result.error))
                    return
                }

                toast.success(t('admin.users.deleted'), {
                    title: t('admin.users.title'),
                })
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_USERS_QUERY_KEY,
                })
            },
            onError: function (error) {
                setDeleteTargetUser(null)
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : t('admin.users.deleteError'),
                    { title: t('common.error') },
                )
            },
        })

    const {
        mutate: toggleUserActiveMutation,
        isPending: isTogglingUserActive,
    } = useMutation({
        mutationFn: async function (user: UserManagementUser) {
            return await setUserActiveHandler({
                data: {
                    id: user.id,
                    isActive: !user.isActive,
                },
            })
        },
        onSuccess: function (result, user) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            queryClient.setQueriesData<Array<UserManagementUser>>(
                { queryKey: ADMIN_USERS_QUERY_KEY },
                (users) =>
                    updateUserActiveStateInList(users, user.id, !user.isActive),
            )
            toast.success(t('admin.users.statusUpdated'), {
                title: t('admin.users.title'),
            })
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('admin.users.statusUpdateError'),
                { title: t('common.error') },
            )
        },
    })

    const {
        mutate: sendPasswordResetMutation,
        isPending: isResendingPasswordReset,
    } = useMutation({
        mutationFn: async function (user: UserManagementUser) {
            return await resetUserPasswordHandler({ data: { id: user.id } })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('admin.users.passwordResetSent'), {
                title: t('admin.users.title'),
            })
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('admin.users.passwordResetError'),
                { title: t('common.error') },
            )
        },
    })

    const handleDeleteUser = useCallback(
        function (user: UserManagementUser) {
            if (user.isCurrentUser) {
                toast.error(t('admin.users.deleteSelfForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            if (user.isSuperUser && !canManageSuperUsers) {
                toast.error(t('admin.users.deleteForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            setDeleteTargetUser(user)
        },
        [canManageSuperUsers, t],
    )

    const handleCloseDeleteModal = useCallback(function () {
        setDeleteTargetUser(null)
    }, [])

    const handleConfirmDeleteUser = useCallback(
        function () {
            if (!deleteTargetUser) {
                return
            }

            const user = deleteTargetUser
            setDeleteTargetUser(null)
            deleteUserMutation(user)
        },
        [deleteTargetUser, deleteUserMutation],
    )

    const handleToggleUserActive = useCallback(
        function (user: UserManagementUser) {
            if (user.isCurrentUser && user.isActive) {
                toast.error(t('admin.users.deactivateSelfForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            if (user.isSuperUser && !canManageSuperUsers) {
                toast.error(t('admin.users.statusForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            toggleUserActiveMutation(user)
        },
        [canManageSuperUsers, t, toggleUserActiveMutation],
    )

    const onPasswordReset = useCallback(
        function (user: UserManagementUser) {
            if (isResendingPasswordReset) {
                return
            }

            if (user.isSuperUser && !canManageSuperUsers) {
                toast.error(t('admin.users.passwordResetForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            sendPasswordResetMutation(user)
        },
        [
            canManageSuperUsers,
            isResendingPasswordReset,
            sendPasswordResetMutation,
            t,
        ],
    )

    return {
        state: {
            deleteTargetUser,
            isDeletingUser,
            isTogglingUserActive,
            isResendingPasswordReset,
        },
        handler: {
            handleDeleteUser,
            handleCloseDeleteModal,
            handleConfirmDeleteUser,
            handleToggleUserActive,
            onPasswordReset,
        },
    }
}
