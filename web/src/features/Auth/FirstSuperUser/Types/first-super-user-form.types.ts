import type { SubmitEvent } from 'react'
import type { z } from 'zod'
import type { createFirstSuperUserAccountFormSchema } from '../validation.ts'

export type FirstSuperUserFormValues = z.infer<
    typeof createFirstSuperUserAccountFormSchema
>
export type FirstSuperUserFormField = keyof FirstSuperUserFormValues

export type CreateFirstSuperUserAccountLogicReturn = {
    state: {
        formValues: FirstSuperUserFormValues
        isCreating: boolean
        setupAccessState: 'checking' | 'granted' | 'missing'
    }
    handler: {
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
    }
    setter: {
        setFieldValue: (field: FirstSuperUserFormField, value: string) => void
    }
}
