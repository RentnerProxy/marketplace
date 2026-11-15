import { z } from 'zod'
import { PASSWORD_POLICY } from '@/config/security.config.ts'

export const authCredentialPasswordSchema = z
    .string()
    .min(1)
    .max(PASSWORD_POLICY.maximumLength)
export const authNewPasswordSchema = z
    .string()
    .min(PASSWORD_POLICY.minimumNewLength)
    .max(PASSWORD_POLICY.maximumLength)
export const authEmailSchema = z.string().trim().pipe(z.email().max(255))
