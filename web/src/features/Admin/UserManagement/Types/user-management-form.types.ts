import type { AppForm } from '@/shared/Types/form.types.ts'

export type CreateUserFormValues = {
    username: string
    email: string
}

export type CreateUserForm = AppForm<CreateUserFormValues>

export type UpdateUserFormValues = {
    id: string
    username: string
    email: string
    firstName: string
    lastName: string
    street: string
    houseNumber: string
    postalCode: string
    city: string
}
