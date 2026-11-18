import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from '@/server/Auth/authorization.errors.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'

const staffPermissions = {
    review: PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
    assignNamespace: PERMISSIONS.ADMIN_MARKETPLACE_NAMESPACE,
} as const

type MarketplaceAction = 'submit' | 'rate' | keyof typeof staffPermissions

export async function requireMarketplaceAccountAccessService(
    action: MarketplaceAction,
) {
    const { sessionUser, permissionKeys } =
        await requireAuthenticatedFeatureAccessService()
    if (sessionUser.expiresAt.getTime() <= Date.now())
        throw new AuthenticationRequiredError()

    const allowed =
        action === 'submit' || action === 'rate'
            ? sessionUser.accountType === 'public' &&
              sessionUser.emailVerifiedAt
            : sessionUser.accountType === 'staff' &&
              hasPermission(permissionKeys, staffPermissions[action])
    if (!allowed) throw new PermissionDeniedError()

    return { userId: sessionUser.id }
}
