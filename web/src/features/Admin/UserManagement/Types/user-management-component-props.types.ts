import type { UpdateUserFormValues } from './user-management-form.types.ts'

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
