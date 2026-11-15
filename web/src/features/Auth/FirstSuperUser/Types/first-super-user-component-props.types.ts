import type {
    FirstSuperUserFormField,
    FirstSuperUserFormValues,
} from './first-super-user-form.types.ts'

export type FirstSuperUserFormSectionProps = {
    values: FirstSuperUserFormValues
    onFieldChange: (field: FirstSuperUserFormField, value: string) => void
}

export type SetupSubmitButtonProps = {
    isCreating: boolean
}

export type SetupAccessNoticeProps = {
    isChecking: boolean
}
