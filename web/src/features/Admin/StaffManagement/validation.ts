import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { permissionKeysSchema } from '@/lib/Permissions/permissionSchemas.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'

export const inviteStaffInputSchema = z.object({
    username: z.string().trim().min(1).max(50),
    email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
    permissionKeys: permissionKeysSchema
        .refine((keys) => !keys.includes(PERMISSIONS.ADMIN_SUPER_USER))
        .refine((keys) => getDefaultRouteForPermissions(keys) !== '/login'),
})

export const revokeStaffInvitationInputSchema = z.object({ id: z.uuidv7() })
