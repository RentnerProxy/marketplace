import type { UpdateUserFormValues } from '../../../Types/user-management-form.types.ts'
import type { UserEditModalHandler } from './user-edit-modal-logic.types.ts'

export type HeaderProps = {
    onClose: () => void
}

export type FooterProps = {
    isUpdatingUser: boolean
    onClose: () => void
}

export type GeneralUserInfoProps = {
    draftForm: UpdateUserFormValues
    onFieldChange: UserEditModalHandler['handleFieldChange']
}
