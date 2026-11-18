import { createServerFn } from '@tanstack/react-start'
import {
    accountManagementScopeSchema,
    convertAccountTypeInputSchema,
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '@/features/Admin/UserManagement/validation.ts'
import { deleteUserService } from '@/server/Admin/UserManagement/delete.service.ts'
import { convertAccountTypeService } from '@/server/Admin/UserManagement/accountConversion.service.ts'
import {
    getPermissionsService,
    getUsersService,
} from '@/server/Admin/UserManagement/get.service.ts'
import { resetUserPasswordService } from '@/server/Admin/UserManagement/password.service.ts'
import { setUserActiveService } from '@/server/Admin/UserManagement/active.service.ts'
import { updateUserProfileService } from '@/server/Admin/UserManagement/update.service.ts'
import {
    canConvertAccountType,
    getAccountManagementPermission,
} from '@/lib/UserManagement/accountManagementPermission.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export const getPermissionsHandler = createServerFn({ method: 'GET' })
    .validator((data: unknown) => accountManagementScopeSchema.parse(data))
    .handler(async ({ data }) => {
        await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        return getPermissionsService(data.accountType)
    })

export const getUsersHandler = createServerFn({ method: 'GET' })
    .validator((data: unknown) => accountManagementScopeSchema.parse(data))
    .handler(async ({ data }) => {
        const access = await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        return getUsersService(data.accountType, access.userId)
    })

export const updateUserProfileHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateUserProfileInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        return updateUserProfileService(data)
    })

export const deleteUserHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return deleteUserInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        return deleteUserService(data)
    })

export const convertAccountTypeHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => convertAccountTypeInputSchema.parse(data))
    .handler(async ({ data }) => {
        const { userId, permissionKeys } = await requirePermissionService(
            PERMISSIONS.ADMIN_ACCOUNT_CONVERSION,
        )
        if (!canConvertAccountType(permissionKeys, data.accountType)) {
            throw new PermissionDeniedError()
        }
        return convertAccountTypeService(data, userId)
    })

export const setUserActiveHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return setUserActiveInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        return setUserActiveService(data)
    })

export const resetUserPasswordHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return resetUserPasswordInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            getAccountManagementPermission(data.accountType),
        )
        await enforceRateLimit({
            ...RATE_LIMITS.adminPasswordResetIp,
            scope: 'admin-user-password-reset-ip',
            identifiers: [access.userId],
        })
        await enforceRateLimit({
            ...RATE_LIMITS.adminPasswordResetTarget,
            scope: 'admin-user-password-reset-target',
            identifiers: [access.userId, data.id],
            includeClientIp: false,
        })
        return resetUserPasswordService(data)
    })
