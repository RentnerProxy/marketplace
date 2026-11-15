import type {
    CreateUserForm,
    UpdateUserFormValues,
} from './user-management-form.types.ts'
import type { SubmitEvent } from 'react'

export type CreateUserPanelProps = {
    form: CreateUserForm
    isCreatingUser: boolean
    onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
}

export type UserAvatarProps = {
    userId: string
    profileImageVersion: number | null
    username: string
}

export type EditUserModalProps = {
    isOpen: boolean
    editForm: UpdateUserFormValues
    isUpdatingUser: boolean
    onClose: () => void
    onSubmit: (values: UpdateUserFormValues) => void
}
