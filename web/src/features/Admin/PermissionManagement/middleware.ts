import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import {
    getPublicAccountDefaultsService,
    replaceDefaultPermissionsService,
} from '@/server/Admin/PermissionManagement/defaults.service.ts'
import { getPermissionManagementOverviewService } from '@/server/Admin/PermissionManagement/overview.service.ts'
import {
    createPermissionPresetService,
    deletePermissionPresetService,
    updatePermissionPresetService,
} from '@/server/Admin/PermissionManagement/presets.service.ts'
import { getPermissionManagementUsersService } from '@/server/Admin/PermissionManagement/users.service.ts'
import { replaceManagedUserPermissionsService } from '@/server/Admin/PermissionManagement/managed-user-permissions.service.ts'
import {
    createPermissionPresetInputSchema,
    deletePermissionPresetInputSchema,
    replaceDefaultPermissionsInputSchema,
    replaceManagedUserPermissionsInputSchema,
    updatePermissionPresetInputSchema,
} from './validation.ts'

export const getPermissionManagementOverviewHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    const access = await requirePermissionService(PERMISSIONS.ADMIN_SUPER_USER)
    return getPermissionManagementOverviewService(access.userId)
})

export const getPermissionManagementUsersHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    const access = await requirePermissionService(PERMISSIONS.ADMIN_SUPER_USER)
    return getPermissionManagementUsersService(access.userId)
})

export const getPublicAccountDefaultsHandler = createServerFn({
    method: 'GET',
}).handler(async () => {
    const { userId } = await requirePermissionService(
        PERMISSIONS.ADMIN_SUPER_USER,
    )
    return getPublicAccountDefaultsService(userId)
})

export const replaceDefaultPermissionsHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return replaceDefaultPermissionsInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        return replaceDefaultPermissionsService(data, access.userId)
    })

export const createPermissionPresetHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return createPermissionPresetInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        return createPermissionPresetService(data, access.userId)
    })

export const updatePermissionPresetHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return updatePermissionPresetInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        return updatePermissionPresetService(data, access.userId)
    })

export const deletePermissionPresetHandler = createServerFn({ method: 'POST' })
    .validator(function (data: unknown) {
        return deletePermissionPresetInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        return deletePermissionPresetService(data, access.userId)
    })

export const replaceManagedUserPermissionsHandler = createServerFn({
    method: 'POST',
})
    .validator(function (data: unknown) {
        return replaceManagedUserPermissionsInputSchema.parse(data)
    })
    .handler(async function ({ data }) {
        const access = await requirePermissionService(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        return replaceManagedUserPermissionsService(data, access.userId)
    })
