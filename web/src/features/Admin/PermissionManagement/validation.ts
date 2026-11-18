import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { permissionKeysSchema } from '@/lib/Permissions/permissionSchemas.ts'

const automaticPermissionKeysSchema = permissionKeysSchema.refine(
    (permissionKeys) => !permissionKeys.includes(PERMISSIONS.ADMIN_SUPER_USER),
    'Das Superuser-Recht darf nicht automatisch vergeben werden.',
)
const presetValuesSchema = z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500),
    permissionKeys: automaticPermissionKeysSchema,
})

export const createPermissionPresetInputSchema = presetValuesSchema

export const updatePermissionPresetInputSchema = presetValuesSchema.extend({
    id: z.uuidv7(),
})

export const deletePermissionPresetInputSchema = z.object({
    id: z.uuidv7(),
})

export const replaceManagedUserPermissionsInputSchema = z.object({
    userId: z.uuidv7(),
    permissionKeys: permissionKeysSchema,
})
