import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const knownPermissionKeys = new Set<string>(Object.values(PERMISSIONS))

export const permissionKeySchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(
        (permissionKey) => knownPermissionKeys.has(permissionKey),
        'Unbekannte Berechtigung.',
    )

export const permissionKeysSchema = z
    .array(permissionKeySchema)
    .max(knownPermissionKeys.size)
    .refine(
        (permissionKeys) =>
            new Set(permissionKeys).size === permissionKeys.length,
        'Berechtigungen dürfen nicht doppelt angegeben werden.',
    )
