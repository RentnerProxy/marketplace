import { z } from 'zod'
import { optionalTextSchema } from '@/lib/Validation/zodSchemas.ts'

const usernameSchema = z.string().trim().min(1).max(50)
const emailSchema = z.string().trim().pipe(z.email().max(255))
const userIdSchema = z.uuidv7()

export const createUserInputSchema = z.object({
    username: usernameSchema,
    email: emailSchema,
})

export const updateUserProfileInputSchema = z.object({
    id: userIdSchema,
    username: usernameSchema,
    email: emailSchema,
    firstName: optionalTextSchema(100),
    lastName: optionalTextSchema(100),
    street: optionalTextSchema(100),
    houseNumber: optionalTextSchema(20),
    postalCode: optionalTextSchema(20),
    city: optionalTextSchema(100),
})

export const deleteUserInputSchema = z.object({
    id: userIdSchema,
})

export const setUserActiveInputSchema = z.object({
    id: userIdSchema,
    isActive: z.boolean(),
})

export const resetUserPasswordInputSchema = z.object({
    id: userIdSchema,
})
