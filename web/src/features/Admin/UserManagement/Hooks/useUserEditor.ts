import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { updateUserProfileHandler } from '../middleware.ts'
import type { UpdateUserFormValues } from '../Types/user-management-form.types.ts'
import type { UserManagementUser } from '../Types/user-management-domain.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'

const emptyEditForm: UpdateUserFormValues = {
    id: '',
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
}

export default function useUserEditor(canManageSuperUsers: boolean) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [editForm, setEditForm] =
        useState<UpdateUserFormValues>(emptyEditForm)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const handleCloseEditModal = useCallback(function () {
        setIsEditModalOpen(false)
        setEditForm(emptyEditForm)
    }, [])

    const { mutate: updateUserMutation, isPending: isUpdatingUser } =
        useMutation({
            mutationFn: async function (values: UpdateUserFormValues) {
                return await updateUserProfileHandler({ data: values })
            },
            onSuccess: async function (result) {
                if (!result.success) {
                    toastAppError(new AppError(result.error))
                    return
                }

                toast.success(t('admin.users.updated'), {
                    title: t('admin.users.title'),
                })
                handleCloseEditModal()
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_USERS_QUERY_KEY,
                })
            },
            onError: function (error) {
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : t('admin.users.updateError'),
                    { title: t('common.error') },
                )
            },
        })

    const handleOpenEditModal = useCallback(
        function (user: UserManagementUser) {
            if (user.isSuperUser && !canManageSuperUsers) {
                toast.error(t('admin.users.editForbidden'), {
                    title: t('admin.users.title'),
                })
                return
            }

            setEditForm({
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.firstName ?? '',
                lastName: user.lastName ?? '',
                street: user.street ?? '',
                houseNumber: user.houseNumber ?? '',
                postalCode: user.postalCode ?? '',
                city: user.city ?? '',
            })
            setIsEditModalOpen(true)
        },
        [canManageSuperUsers, t],
    )

    const handleUpdateUser = useCallback(
        function (values: UpdateUserFormValues) {
            updateUserMutation(values)
        },
        [updateUserMutation],
    )

    return {
        state: {
            editForm,
            isEditModalOpen,
            isUpdatingUser,
        },
        handler: {
            handleOpenEditModal,
            handleCloseEditModal,
            handleUpdateUser,
        },
    }
}
