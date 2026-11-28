import type { updateUserInTransaction } from '../updateTransaction.service.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'

export type SuccessfulUserUpdateTransaction = Extract<
    Awaited<ReturnType<typeof updateUserInTransaction>>,
    { success: true }
>

export type NormalizedUserUpdate = {
    id: string
    accountType: AccountType
    username: string
    email: string
}
