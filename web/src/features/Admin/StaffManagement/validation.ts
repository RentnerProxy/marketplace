import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { permissionKeysSchema } from '@/lib/Permissions/permissionSchemas.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'

const staffInvitationPermissionKeysSchema = permissionKeysSchema
    .refine((keys) => !keys.includes(PERMISSIONS.ADMIN_SUPER_USER))
    .refine((keys) => getDefaultRouteForPermissions(keys) !== '/login')

export const inviteStaffInputSchema = z.object({
    username: z.string().trim().min(1).max(50),
    email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
    permissionKeys: staffInvitationPermissionKeysSchema,
})

const staffInvitationIdSchema = z.object({ id: z.uuidv7() })

export const manageStaffInvitationInputSchema = z.discriminatedUnion('action', [
    staffInvitationIdSchema.extend({ action: z.literal('revoke') }),
    staffInvitationIdSchema.extend({ action: z.literal('resend') }),
    staffInvitationIdSchema.extend({
        action: z.literal('setActive'),
        isActive: z.boolean(),
    }),
    staffInvitationIdSchema.extend({
        action: z.literal('permissions'),
        expectedPermissionKeys: z.array(z.string().min(1).max(100)).max(100),
        permissionKeys: staffInvitationPermissionKeysSchema,
    }),
])
