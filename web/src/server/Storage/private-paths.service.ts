import path from 'node:path'
import { z } from 'zod'

const nativeUnsignedIdentitySchema = z
    .string()
    .min(1)
    .max(20)
    .refine(function (value) {
        return (
            /^(?:0|[1-9]\d{0,19})$/.test(value) &&
            BigInt(value) <= 18446744073709551615n
        )
    })
export const nativeStorageIdentitySchema = z
    .object({
        dev: nativeUnsignedIdentitySchema,
        ino: nativeUnsignedIdentitySchema.refine((value) => value !== '0'),
    })
    .strict()
export const nativeStorageAbsolutePathSchema = z
    .string()
    .min(1)
    .max(65536)
    .refine(function (value) {
        return (
            !value.includes('\0') &&
            path.isAbsolute(value) &&
            path.resolve(value) === value
        )
    })
