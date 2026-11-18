import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    convertAccountTypeHandler,
    deleteUserHandler,
    resetUserPasswordHandler,
    setUserActiveHandler,
} from '../middleware.ts'
import { PERMISSION_MANAGEMENT_USERS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import type { UserManagementUser } from '../Types/user-management-domain.types.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import { updateUserActiveStateInList } from '@/lib/UserManagement/userCache.ts'

export default function useUserAccountActions(
    accountType: AccountType,
    canManageSuperUsers: boolean,
    canConvertAccounts: boolean,
) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [deleteTargetUser, setDeleteTargetUser] =
        useState<UserManagementUser | null>(null)
    const [conversionTarget, setConversionTarget] =
        useState<UserManagementUser | null>(null)

    const { mutate: convertAccount, isPending: isConvertingAccount } =
        useMutation({
            mutationFn: (user: UserManagementUser) =>
                convertAccountTypeHandler({
                    data: { id: user.id, accountType },
                }),
            async onSuccess(result) {
                const title = t('admin.users.conversion.title')
                if (!result.success) {
                    toast.error(
                        t(`admin.users.conversion.errors.${result.error}`),
                        { title },
                    )
                    return
                }

                setConversionTarget(null)
                toast.success(t('admin.users.conversion.converted'), { title })
                await Promise.all([
                    queryClient.invalidateQueries({
                        queryKey: ADMIN_USERS_QUERY_KEY,
                    }),
                    queryClient.invalidateQueries({
                        queryKey: PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
                    }),
                ])
            },
            onError: (error) => toastAppError(error),
        })

    const handleAskConvertAccount = useCallback(
        (user: UserManagementUser) => {
            if (
                canConvertAccounts &&
                !user.isCurrentUser &&
                (!user.isSuperUser || canManageSuperUsers)
            ) {
                setConversionTarget(user)
            }
        },
        [canConvertAccounts, canManageSuperUsers],
    )

    const { mutate: deleteUserMutation, isPending: isDeletingUser } =
        useMutation({
            mutationFn: async function (user: UserManagementUser) {
                return await deleteUserHandler({
                    data: { id: user.id, accountType },
                })
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
                    queryKey: [...ADMIN_USERS_QUERY_KEY, accountType],
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
                    accountType,
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
                { queryKey: [...ADMIN_USERS_QUERY_KEY, accountType] },
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
            return await resetUserPasswordHandler({
                data: { id: user.id, accountType },
            })
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
            conversionTarget,
            isConvertingAccount,
            isDeletingUser,
            isTogglingUserActive,
            isResendingPasswordReset,
        },
        handler: {
            handleAskConvertAccount,
            handleCloseConversion: () => setConversionTarget(null),
            handleConfirmConversion: () => {
                if (
                    conversionTarget &&
                    canConvertAccounts &&
                    !isConvertingAccount
                )
                    convertAccount(conversionTarget)
            },
            handleDeleteUser,
            handleCloseDeleteModal,
            handleConfirmDeleteUser,
            handleToggleUserActive,
            onPasswordReset,
        },
    }
}
