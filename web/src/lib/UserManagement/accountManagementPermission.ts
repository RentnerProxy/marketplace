import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'

export function getAccountManagementPermission(accountType: AccountType) {
    return accountType === 'staff'
        ? PERMISSIONS.ADMIN_SUPER_USER
        : PERMISSIONS.ADMIN_USER_MANAGEMENT
}
