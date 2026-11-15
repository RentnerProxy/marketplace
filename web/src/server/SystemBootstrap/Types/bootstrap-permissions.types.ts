import type { permissions } from '@/db/schema.ts'

export type SyncedPermission = Pick<
    typeof permissions.$inferSelect,
    'id' | 'key'
>

export type SyncDefaultPermissionsOptions = {
    prune?: boolean
    grantAdminPermissionsToSuperUsers?: boolean
}
