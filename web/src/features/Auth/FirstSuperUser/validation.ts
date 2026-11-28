import { z } from 'zod'
import {
    authEmailSchema,
    authNewPasswordSchema,
} from '@/lib/Auth/validation.ts'

const firstSuperUserFormFields = z.object({
    username: z.string().trim().min(1).max(50),
    email: authEmailSchema,
    password: authNewPasswordSchema,
    confirmPassword: authNewPasswordSchema,
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
