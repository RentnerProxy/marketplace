import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'

export function getAccountManagementPermission(accountType: AccountType) {
    return accountType === 'staff'
        ? PERMISSIONS.ADMIN_SUPER_USER
        : PERMISSIONS.ADMIN_USER_MANAGEMENT
}

export function canConvertAccountType(
    permissionKeys: Array<string> | undefined,
    accountType: AccountType,
) {
    return (
        hasPermission(permissionKeys, PERMISSIONS.ADMIN_ACCOUNT_CONVERSION) &&
        hasPermission(
            permissionKeys,
            getAccountManagementPermission(accountType),
        )
    )
}
