import type { updateUserInTransaction } from '../updateTransaction.service.ts'

export type SuccessfulUserUpdateTransaction = Extract<
    Awaited<ReturnType<typeof updateUserInTransaction>>,
    { success: true }
>

export type NormalizedUserUpdate = {
    id: string
    username: string
    email: string
    profile: {
        firstName: string | null
        lastName: string | null
        street: string | null
        houseNumber: string | null
        postalCode: string | null
        city: string | null
    }
}
