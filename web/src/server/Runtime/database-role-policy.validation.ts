import { z } from 'zod'
import { DATABASE_ROLE_POLICY } from '@/config/database-role-policy.config.ts'
import type { DatabaseRolePolicyRow } from './Types/database-role-policy.types.ts'

const oidSchema = z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/u)
    .refine(
        (value) =>
            String(Number(value)) === value && Number(value) <= 4_294_967_295,
    )

const databaseRolePolicyRowSchema = z.strictObject({
    currentRoleId: oidSchema,
    sessionRoleId: oidSchema,
    databaseOwnerId: oidSchema,
    roleId: oidSchema,
    roleName: z
        .string()
        .min(1)
        .max(63)
        .refine(
            (value) =>
                !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= 63,
        ),
    canLogin: z.boolean(),
    isSuperuser: z.boolean(),
    canCreateDatabase: z.boolean(),
    canCreateRole: z.boolean(),
    canReplicate: z.boolean(),
    canBypassRls: z.boolean(),
    ownsOtherDatabase: z.boolean(),
}) satisfies z.ZodType<DatabaseRolePolicyRow>

export const databaseRolePolicyRowsSchema = z
    .array(databaseRolePolicyRowSchema)
    .min(1)
    .max(DATABASE_ROLE_POLICY.maximumRoles)

export function hasRequiredDatabaseRolePolicyService(
    rows: Array<DatabaseRolePolicyRow>,
) {
    const context = rows[0]
    if (!context || context.currentRoleId !== context.sessionRoleId) {
        return false
    }

    const currentRole = rows.find(
        (role) => role.roleId === context.currentRoleId,
    )
    const usesDatabaseAdministrator = currentRole?.isSuperuser === true
    if (
        !usesDatabaseAdministrator &&
        context.currentRoleId !== context.databaseOwnerId
    ) {
        return false
    }

    const seenRoleIds = new Set<string>()
    const seenRoleNames = new Set<string>()
    let hasLoginRole = false
    for (const role of rows) {
        if (
            role.currentRoleId !== context.currentRoleId ||
            role.sessionRoleId !== context.sessionRoleId ||
            role.databaseOwnerId !== context.databaseOwnerId ||
            seenRoleIds.has(role.roleId) ||
            seenRoleNames.has(role.roleName) ||
            (!usesDatabaseAdministrator &&
                (role.isSuperuser ||
                    role.canCreateDatabase ||
                    role.canCreateRole ||
                    role.canReplicate ||
                    role.canBypassRls ||
                    role.ownsOtherDatabase ||
                    (role.roleName.startsWith('pg_') &&
                        !DATABASE_ROLE_POLICY.allowedSystemRoles.some(
                            (allowedRole) => allowedRole === role.roleName,
                        ))))
        ) {
            return false
        }
        seenRoleIds.add(role.roleId)
        seenRoleNames.add(role.roleName)
        if (role.roleId === context.currentRoleId) {
            hasLoginRole = role.canLogin
        }
    }
    return hasLoginRole
}
