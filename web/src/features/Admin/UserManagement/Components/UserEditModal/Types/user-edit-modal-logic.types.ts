import type { SubmitEvent } from 'react'
import type { EditUserModalProps } from '../../../Types/user-management-component-props.types.ts'
import type { UpdateUserFormValues } from '../../../Types/user-management-form.types.ts'

type UserEditModalState = {
    draftForm: UpdateUserFormValues
}

export type UserEditModalHandler = {
    handleFieldChange: <TKey extends keyof UpdateUserFormValues>(
        key: TKey,
        value: UpdateUserFormValues[TKey],
    ) => void
    handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
}

export type UserEditModalLogicParams = Pick<
    EditUserModalProps,
    'editForm' | 'isOpen' | 'onSubmit'
>

export type UserEditModalLogicReturn = {
    state: UserEditModalState
    handler: UserEditModalHandler
}
