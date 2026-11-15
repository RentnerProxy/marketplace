import type { UseCreateUserFormParams } from '../Types/user-management-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { createUserHandler } from '../middleware.ts'
import type { CreateUserFormValues } from '../Types/user-management-form.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import type { SubmitEvent } from 'react'

export default function useCreateUserForm({
    onCreateResponse,
}: UseCreateUserFormParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const createForm = useForm({
        defaultValues: {
            username: '',
            email: '',
        } satisfies CreateUserFormValues,
        onSubmit: async function ({ value }) {
            handleCreateUser(value)
        },
    })

    const { mutate: createUserMutation, isPending: isCreatingUser } =
        useMutation({
            mutationFn: async function (values: CreateUserFormValues) {
                return await createUserHandler({
                    data: values,
                })
            },
            onSuccess: async function (result) {
                onCreateResponse()

                if (!result.success) {
                    toastAppError(new AppError(result.error))
                    return
                }

                toast.success(t('admin.users.createdAndInvited'), {
                    title: t('admin.users.title'),
                })
                createForm.reset()
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_USERS_QUERY_KEY,
                })
            },
            onError: function (error) {
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : t('admin.users.createError'),
                    { title: t('common.error') },
                )
            },
        })

    function handleCreateUser(values: CreateUserFormValues) {
        createUserMutation(values)
    }

    function handleSubmit(
        event: Pick<
            SubmitEvent<HTMLFormElement>,
            'preventDefault' | 'stopPropagation'
        >,
    ) {
        event.preventDefault()
        event.stopPropagation()
        void createForm.handleSubmit().catch(toastAppError)
    }

    return {
        state: {
            isCreatingUser,
        },
        form: createForm,
        handler: { handleSubmit },
    }
}
