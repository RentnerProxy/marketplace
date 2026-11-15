import { z } from 'zod'
import {
    authEmailSchema,
    authNewPasswordSchema,
} from '@/lib/Auth/validation.ts'
import { optionalTextSchema } from '@/lib/Validation/zodSchemas.ts'

const firstSuperUserFormFields = z.object({
    username: z.string().trim().min(1).max(50),
    email: authEmailSchema,
    password: authNewPasswordSchema,
    confirmPassword: authNewPasswordSchema,
    firstName: optionalTextSchema(100),
    lastName: optionalTextSchema(100),
    street: optionalTextSchema(100),
    houseNumber: optionalTextSchema(20),
    postalCode: optionalTextSchema(20),
    city: optionalTextSchema(100),
})

export const createFirstSuperUserAccountFormSchema =
    firstSuperUserFormFields.refine(
        (data) => data.password === data.confirmPassword,
        {
            path: ['confirmPassword'],
            message: 'passwords_must_match',
        },
    )

export const createFirstSuperUserAccountInputSchema = firstSuperUserFormFields
    .extend({
        setupToken: z.string().trim().max(255).default(''),
    })
    .refine((data) => data.password === data.confirmPassword, {
        path: ['confirmPassword'],
        message: 'passwords_must_match',
    })
