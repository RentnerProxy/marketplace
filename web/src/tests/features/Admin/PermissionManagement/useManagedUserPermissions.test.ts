import * as Table from '@tanstack/react-table'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    appError,
    client,
    error,
    query,
    render,
    reset,
    settle,
    success,
} from '../UserManagement/user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import { PERMISSION_MANAGEMENT_USERS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import type {
    PermissionManagementUser,
    PermissionPreset,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

const replace = vi.fn()
const refetch = vi.fn(async () => {})
const setPageIndex = vi.fn()
const firstPage = vi.fn()
const nextPage = vi.fn()
const previousPage = vi.fn()
const setGlobalFilter = vi.fn()
let actor: string | undefined = 'actor'
let users: Array<PermissionManagementUser> = []
let fetching = false
let failed = false
let pageIndex = 0
let pageCount = 1
let search: unknown = ''
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@tanstack/react-table', () => ({
    ...Table,
    useTable(
        options: {
            data: Array<PermissionManagementUser>
            getRowId: (user: PermissionManagementUser) => string
            getColumnCanGlobalFilter: () => boolean
        },
        select: (state: unknown) => unknown,
    ) {
        select({ globalFilter: search, pagination: { pageIndex } })
        options.data.forEach(options.getRowId)
        options.getColumnCanGlobalFilter()
        return {
            state: { globalFilter: search, pagination: { pageIndex } },
            getRowModel: () => ({
                rows: options.data.map((original) => ({ original })),
            }),
            getRowCount: () => options.data.length,
            getPageCount: () => pageCount,
            getCanPreviousPage: () => pageIndex > 0,
            getCanNextPage: () => pageIndex < pageCount - 1,
            setPageIndex,
            firstPage,
            nextPage,
            previousPage,
            setGlobalFilter,
        }
    },
}))
vi.mock('@/features/Admin/PermissionManagement/middleware.ts', () => ({
    replaceManagedUserPermissionsHandler: replace,
    getPermissionManagementUsersHandler: vi.fn(),
}))
import useManagedUserPermissions from '@/features/Admin/PermissionManagement/Hooks/useManagedUserPermissions.ts'

const user: PermissionManagementUser = {
    id: 'user-a',
    username: 'Ada',
    email: 'ada@example.invalid',
    firstName: 'Ada',
    lastName: null,
    isActive: true,
    isSuperUser: false,
    isCurrentUser: false,
    permissions: [PERMISSIONS.USER_DASHBOARD],
}
const other = {
    ...user,
    id: 'user-b',
    permissions: [PERMISSIONS.ADMIN_DASHBOARD],
}
const preset: PermissionPreset = {
    id: 'preset',
    name: 'Admin',
    description: '',
    createdAt: '',
    updatedAt: '',
    permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD, PERMISSIONS.ADMIN_SUPER_USER],
}
const useManaged = () =>
    useManagedUserPermissions({ enabled: true, presets: [preset] })

beforeEach(() => {
    reset()
    actor = 'actor'
    users = [user, other]
    fetching = false
    failed = false
    pageIndex = 0
    pageCount = 1
    search = ''
    replace.mockReset().mockResolvedValue({
        success: true,
        permissionKeys: [
            PERMISSIONS.USER_DASHBOARD,
            PERMISSIONS.ADMIN_DASHBOARD,
        ],
    })
    query.mockImplementation((input: unknown) => {
        const options = input as { queryKey: Array<string> }
        return options.queryKey[0] === 'session'
            ? { data: actor ? { user: { id: actor } } : undefined }
            : {
                  data: users,
                  isLoading: false,
                  isFetching: fetching,
                  isError: failed,
                  refetch,
              }
    })
})

describe('managed user permissions', () => {
    it('isolates user queries by actor and disables them without a session or active tab', () => {
        render(useManaged)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: [...PERMISSION_MANAGEMENT_USERS_QUERY_KEY, 'actor'],
                enabled: true,
            }),
        )
        actor = undefined
        const anonymous = render(useManaged)
        expect(anonymous.state.users).toEqual([])
        expect(anonymous.state.total).toBe(0)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: [
                    ...PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
                    'anonymous',
                ],
                enabled: false,
            }),
        )
        actor = 'actor'
        render(() => useManagedUserPermissions({ enabled: false, presets: [] }))
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({ enabled: false }),
        )
    })

    it('applies presets additively without super-user rights and saves then refreshes both user lists', async () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        let hook = render(useManaged)
        hook.handler.handleSave()
        expect(replace).not.toHaveBeenCalled()
        hook.handler.handleSelectUser(user)
        hook.handler.handleSelectPreset('missing')
        expect(render(useManaged).state.permissionKeys).toEqual(
            user.permissions,
        )
        hook.handler.handleSelectPreset(preset.id)
        hook = render(useManaged)
        expect(hook.state.permissionKeys).toEqual([
            PERMISSIONS.USER_DASHBOARD,
            PERMISSIONS.ADMIN_DASHBOARD,
        ])
        expect(hook.state.permissionKeys).not.toContain(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        expect(hook.state.isDirty).toBe(true)
        hook.handler.handleSave()
        expect(render(useManaged).state.isSaving).toBe(true)
        await settle()
        expect(replace).toHaveBeenCalledWith({
            data: {
                userId: user.id,
                permissionKeys: [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                ],
            },
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: ADMIN_USERS_QUERY_KEY,
        })
        expect(success).toHaveBeenCalledTimes(1)
        invalidate.mockRestore()
    })

    it('does not overwrite another selected user when an earlier save completes', async () => {
        let hook = render(useManaged)
        hook.handler.handleSelectUser(user)
        hook = render(useManaged)
        hook.handler.handleTogglePermission(PERMISSIONS.ADMIN_DASHBOARD)
        render(useManaged).handler.handleSave()
        hook.handler.handleSelectUser(other)
        await settle()
        hook = render(useManaged)
        expect(hook.state.selectedUser?.id).toBe(other.id)
        expect(hook.state.permissionKeys).toEqual(other.permissions)
        expect(hook.state.isDirty).toBe(false)
    })

    it('refreshes a pristine selected user but preserves a changed permission draft', () => {
        render(useManaged).handler.handleSelectUser(user)
        users = [{ ...user, permissions: [PERMISSIONS.ADMIN_DASHBOARD] }, other]
        render(useManaged)
        let hook = render(useManaged)
        expect(hook.state.permissionKeys).toEqual([PERMISSIONS.ADMIN_DASHBOARD])
        hook.handler.handleTogglePermission(PERMISSIONS.USER_DASHBOARD)
        users = [{ ...user, permissions: [] }, other]
        render(useManaged)
        hook = render(useManaged)
        expect(hook.state.permissionKeys).toContain(PERMISSIONS.USER_DASHBOARD)
        expect(hook.state.isDirty).toBe(true)
    })

    it('delegates search, navigation and retries, clamps pages after a shorter result and exposes loading/errors', () => {
        pageIndex = 4
        pageCount = 2
        fetching = true
        failed = true
        search = 123
        const hook = render(useManaged)
        expect(setPageIndex).toHaveBeenCalledWith(1)
        expect(hook.state.isLoading).toBe(true)
        expect(hook.state.isError).toBe(true)
        expect(hook.state.searchInput).toBe('')
        hook.handler.handleSearchInputChange('Ada')
        expect(setGlobalFilter).toHaveBeenCalledWith('Ada')
        expect(firstPage).toHaveBeenCalledTimes(1)
        hook.handler.handlePreviousPage()
        hook.handler.handleNextPage()
        hook.handler.handleRetry()
        expect(previousPage).toHaveBeenCalledTimes(1)
        expect(nextPage).toHaveBeenCalledTimes(1)
        expect(refetch).toHaveBeenCalledTimes(1)
        search = 'Ada'
        pageCount = 0
        expect(render(useManaged).state.searchInput).toBe('Ada')
        expect(render(useManaged).state.pageCount).toBe(1)
    })

    it.each(['rejected', 'network'])(
        'retains the draft on %s failure',
        async (failure) => {
            if (failure === 'rejected')
                replace.mockResolvedValue({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Denied' },
                })
            else replace.mockRejectedValue(new Error('offline'))
            render(useManaged).handler.handleSelectUser(user)
            render(useManaged).handler.handleTogglePermission(
                PERMISSIONS.ADMIN_DASHBOARD,
            )
            render(useManaged).handler.handleSave()
            await settle()
            const hook = render(useManaged)
            expect(hook.state.isDirty).toBe(true)
            expect(success).not.toHaveBeenCalled()
            if (failure === 'rejected')
                expect(appError).toHaveBeenCalledTimes(1)
            else
                expect(error).toHaveBeenCalledWith('offline', {
                    title: 'common.error',
                })
        },
    )
})
