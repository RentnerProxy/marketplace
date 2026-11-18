import { z } from 'zod'
import { optionalTextSchema } from '@/lib/Validation/zodSchemas.ts'

const usernameSchema = z.string().trim().min(1).max(50)
const emailSchema = z.string().trim().pipe(z.email().max(255))
const userIdSchema = z.uuidv7()

export const accountManagementScopeSchema = z.object({
    accountType: z.enum(['public', 'staff']),
})

export const updateUserProfileInputSchema = accountManagementScopeSchema.extend(
    {
        id: userIdSchema,
        username: usernameSchema,
        email: emailSchema,
        firstName: optionalTextSchema(100),
        lastName: optionalTextSchema(100),
        street: optionalTextSchema(100),
        houseNumber: optionalTextSchema(20),
        postalCode: optionalTextSchema(20),
        city: optionalTextSchema(100),
    },
)

const scopedAccountIdSchema = accountManagementScopeSchema.extend({
    id: userIdSchema,
})

export const deleteUserInputSchema = scopedAccountIdSchema
export const convertAccountTypeInputSchema = scopedAccountIdSchema

export const setUserActiveInputSchema = accountManagementScopeSchema.extend({
    id: userIdSchema,
    isActive: z.boolean(),
})

export const resetUserPasswordInputSchema = accountManagementScopeSchema.extend(
    {
        id: userIdSchema,
    },
)
