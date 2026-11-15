import { createServerFn } from '@tanstack/react-start'
import {
    createUserInputSchema,
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '@/features/Admin/UserManagement/validation.ts'
import { createUserService } from '@/server/Admin/UserManagement/create.service.ts'
import { deleteUserService } from '@/server/Admin/UserManagement/delete.service.ts'
import {
    getPermissionsService,
    getUsersService,
} from '@/server/Admin/UserManagement/get.service.ts'
import { resetUserPasswordService } from '@/server/Admin/UserManagement/password.service.ts'
import { setUserActiveService } from '@/server/Admin/UserManagement/active.service.ts'
import { updateUserProfileService } from '@/server/Admin/UserManagement/update.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export const getPermissionsHandler = createServerFn({ method: 'GET' }).handler(
    async function () {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return getPermissionsService()
    },
)

export const getUsersHandler = createServerFn({ method: 'GET' }).handler(
    async function () {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return getUsersService()
    },
)

export const createUserHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return createUserInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return createUserService(data)
    })

export const updateUserProfileHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updateUserProfileInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return updateUserProfileService(data)
    })

export const deleteUserHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return deleteUserInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return deleteUserService(data)
    })

export const setUserActiveHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return setUserActiveInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        await requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT)
        return setUserActiveService(data)
    })

export const resetUserPasswordHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return resetUserPasswordInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
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
