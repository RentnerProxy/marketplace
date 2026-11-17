import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement, isValidElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDataTableLogic } from '@rentnerkev/table'
import type {
    DataTableLogicResult,
    DataTableProps,
} from '@rentnerkev/table/types'
import { query, render, reset } from './user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import type { UsersTableProps } from '@/features/Admin/UserManagement/Components/UsersTable/Types/user-management-table.types.ts'

let actor: string | undefined = 'actor'
let superUser = false
let fetching = false
const user: UserManagementUser = {
    id: 'member',
    username: 'Ada',
    email: 'ada@example.invalid',
    firstName: 'Augusta',
    lastName: 'Lovelace',
    street: null,
    houseNumber: null,
    postalCode: null,
    city: null,
    isActive: true,
    isSuperUser: false,
    isCurrentUser: false,
    createdAt: '2026-01-01T00:00:00Z',
    profileImageVersion: null,
    permissions: [PERMISSIONS.USER_DASHBOARD],
}
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    getUsersHandler: vi.fn(),
}))
vi.mock('@/features/Admin/UserManagement/Components/UserAvatar.tsx', () => ({
    default: ({ username }: { username: string }) =>
        createElement('img', { alt: username }),
}))
import UsersTable from '@/features/Admin/UserManagement/Components/UsersTable/index.tsx'
import useUserTableActionsLogic from '@/features/Admin/UserManagement/Components/UsersTable/Hooks/useUserTableActionsLogic.ts'

const props: UsersTableProps = {
    accountType: 'public',
    availablePermissions: [
        { id: 'z', key: 'z.read', name: 'Z', description: '' },
        { id: 'a', key: 'a.read', name: 'A', description: '' },
        { id: 'duplicate', key: 'z.read', name: 'Z again', description: '' },
        { id: 'm', key: 'm.read', name: 'M', description: '' },
    ],
    isDeletingUser: false,
    isTogglingUserActive: false,
    isResendingPasswordReset: false,
    canManageSuperUsers: false,
    onEditUser: vi.fn(),
    onDeleteUser: vi.fn(),
    onToggleUserActive: vi.fn(),
    onPasswordReset: vi.fn(),
}
function renderTable() {
    const element = render(() => UsersTable(props))
    if (!isValidElement<DataTableProps<UserManagementUser>>(element)) {
        throw new Error('Expected the users data table')
    }
    return element.props
}

beforeEach(() => {
    reset()
    actor = 'actor'
    superUser = false
    fetching = false
    query.mockImplementation((input: unknown) => {
        const queryOptions = input as { queryKey: Array<string> }
        return queryOptions.queryKey[0] === 'session'
            ? {
                  data: actor
                      ? {
                            user: { id: actor },
                            permissions: superUser
                                ? [
                                      PERMISSIONS.ADMIN_SUPER_USER,
                                      PERMISSIONS.ADMIN_USER_MANAGEMENT,
                                  ]
                                : [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                        }
                      : undefined,
              }
            : { data: [user], isLoading: false, isFetching: fetching }
    })
})

describe('users table view', () => {
    it('configures search, loading state, and the column layout controls', () => {
        fetching = true
        const table = renderTable()
        expect(table.searchPlaceholder).toBe('admin.users.searchPlaceholder')
        expect(table.isLoading).toBe(true)
        expect(table.locale).toMatchObject({
            code: 'de',
            messages: { loading: 'admin.users.loading' },
        })
        expect(table.columnSettings).toBe(true)
        expect(table.resizableColumns).toBe(true)
        expect(table.columnWidthMode).toBe('scroll')
        expect(table.pageSizeOptions).toEqual(
            [5, 10, 20, 50].map((value) => ({
                value,
                label: 'admin.users.userCount',
            })),
        )
    })

    it('offers sorted unique permission filters and sorts newest users first', () => {
        const table = renderTable()
        expect(table.columns[2]?.meta?.filter).toMatchObject({
            type: 'select',
            match: 'includes',
            options: [
                { value: 'a.read', label: 'a.read' },
                { value: 'm.read', label: 'm.read' },
                { value: 'z.read', label: 'z.read' },
            ],
        })
        expect(table.tableOptions?.initialState?.sorting).toEqual([
            { id: 'createdAt', desc: true },
        ])
        expect(table.getRowId(user, 0)).toBe(user.id)
    })

    it('supplies all identity fields, including names without columns, to the table search', () => {
        const getSearchValues = renderTable().getSearchValues
        if (!getSearchValues) throw new Error('Missing user search values')
        expect(renderTable().getSearchValues).toBe(getSearchValues)
        expect(getSearchValues(user)).toEqual([
            user.username,
            user.email,
            user.firstName,
            user.lastName,
        ])
        expect(
            getSearchValues({ ...user, firstName: null, lastName: null }),
        ).toEqual([user.username, user.email, null, null])
    })

    it('filters hidden names and exact permissions through the table instance', () => {
        const options = renderTable()
        const data = [
            { ...user, permissions: ['a.read', 'z.read'] },
            {
                ...user,
                id: 'other',
                firstName: null,
                lastName: null,
                permissions: ['a.read.extended'],
            },
        ]
        let logic: DataTableLogicResult<UserManagementUser> | undefined
        function Capture() {
            logic = useDataTableLogic({ ...options, data })
            return null
        }
        renderToStaticMarkup(createElement(Capture))
        if (!logic) throw new Error('Missing user table logic')
        const { table, handler } = logic
        const rowIds = () =>
            table.getFilteredRowModel().rows.map((row) => row.id)

        for (const search of [' augusta ', 'LOVELACE']) {
            handler.handleSearch(search)
            expect(rowIds()).toEqual([user.id])
        }
        handler.handleSearch('')
        const permissions = table.getColumn('permissions')
        if (!permissions) throw new Error('Missing user permissions column')
        permissions.setFilterValue('a.read')
        expect(rowIds()).toEqual([user.id])
        permissions.setFilterValue('')
        expect(rowIds()).toEqual([user.id, 'other'])
    })

    it('uses account-scoped queries, exposes background loading and hides anonymous cached rows', () => {
        expect(renderTable().data).toEqual([user])
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-users', 'public', 'actor'],
                enabled: true,
            }),
        )
        superUser = true
        fetching = true
        expect(renderTable().isLoading).toBe(true)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-users', 'public', 'actor'],
            }),
        )
        actor = undefined
        expect(renderTable().data).toEqual([])
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({ enabled: false }),
        )
    })

    it('renders user identity, rights, status, dates and forwards actions for the selected row', () => {
        const { columns } = renderTable()
        function cell(index: number, original = user) {
            const renderer = columns[index]?.cell as (
                input: unknown,
            ) => ReactElement
            return renderer({
                row: { original },
                getValue: () => original.email,
            })
        }
        expect(renderToStaticMarkup(cell(0))).toContain('Ada')
        expect(
            renderToStaticMarkup(cell(0, { ...user, isSuperUser: true })),
        ).toContain('admin.users.superuser')
        expect(renderToStaticMarkup(cell(1))).toContain(user.email)
        expect(renderToStaticMarkup(cell(2))).toContain(
            'admin.users.rightsCount',
        )
        expect(renderToStaticMarkup(cell(3))).toContain('common.active')
        expect(
            renderToStaticMarkup(cell(3, { ...user, isActive: false })),
        ).toContain('admin.users.deactivated')
        expect(renderToStaticMarkup(cell(4))).toMatch(/2026/)
        const actions = cell(5) as ReactElement<{
            user: UserManagementUser
            onEditUser: (value: UserManagementUser) => void
        }>
        actions.props.onEditUser(actions.props.user)
        expect(props.onEditUser).toHaveBeenCalledWith(user)
        const statusColumn = columns[3]
        if (
            !statusColumn ||
            !('accessorFn' in statusColumn) ||
            !statusColumn.accessorFn
        )
            throw new Error('Expected status accessor')
        expect(statusColumn.accessorFn(user, 0)).toBe('active')
        expect(statusColumn.accessorFn({ ...user, isActive: false }, 0)).toBe(
            'deactivated',
        )
    })
})

describe('user row actions', () => {
    it('forwards each allowed action with the correct user', () => {
        const hook = render(() => useUserTableActionsLogic({ ...props, user }))
        hook.handler.handleEditUser()
        hook.handler.handleToggleUserActive()
        hook.handler.handlePasswordReset()
        hook.handler.handleDeleteUser()
        for (const callback of [
            props.onEditUser,
            props.onToggleUserActive,
            props.onPasswordReset,
            props.onDeleteUser,
        ])
            expect(callback).toHaveBeenCalledWith(user)
        expect(hook.state.isDeleteDisabled).toBe(false)
        expect(hook.state.isPasswordResetDisabled).toBe(false)
    })

    it('disables protected super-user actions and explains the restriction', () => {
        const { state } = render(() =>
            useUserTableActionsLogic({
                ...props,
                user: { ...user, isSuperUser: true },
            }),
        )
        expect(state.isProtectedSuperUser).toBe(true)
        expect(state.isDeleteDisabled).toBe(true)
        expect(state.isToggleStatusDisabled).toBe(true)
        expect(state.isPasswordResetDisabled).toBe(true)
        expect(state.editTooltip).toBe('admin.users.editForbiddenShort')
        expect(state.toggleStatusTooltip).toBe(
            'admin.users.statusForbiddenShort',
        )
        expect(state.passwordResetTooltip).toBe(
            'admin.users.passwordResetForbiddenShort',
        )
        expect(state.deleteTooltip).toBe('admin.users.deleteForbiddenShort')
    })

    it('prevents self deletion/deactivation and offers activation for inactive users', () => {
        let hook = render(() =>
            useUserTableActionsLogic({
                ...props,
                user: { ...user, isCurrentUser: true },
            }),
        )
        expect(hook.state.isDeleteDisabled).toBe(true)
        expect(hook.state.toggleStatusTooltip).toBe(
            'admin.users.deactivateSelfForbiddenShort',
        )
        expect(hook.state.deleteTooltip).toBe(
            'admin.users.deleteSelfForbiddenShort',
        )
        hook = render(() =>
            useUserTableActionsLogic({
                ...props,
                user: { ...user, isActive: false },
            }),
        )
        expect(hook.state.isToggleStatusDisabled).toBe(false)
        expect(hook.state.toggleStatusTooltip).toBe('common.activate')
        expect(hook.state.isPasswordResetDisabled).toBe(true)
        expect(hook.state.passwordResetTooltip).toBe(
            'admin.users.passwordResetInactiveShort',
        )
    })

    it('disables pending actions even when the actor can manage super users', () => {
        const { state } = render(() =>
            useUserTableActionsLogic({
                ...props,
                user: { ...user, isSuperUser: true },
                canManageSuperUsers: true,
                isDeletingUser: true,
                isTogglingUserActive: true,
                isResendingPasswordReset: true,
            }),
        )
        expect(state.isProtectedSuperUser).toBe(false)
        expect(state.isDeleteDisabled).toBe(true)
        expect(state.isToggleStatusDisabled).toBe(true)
        expect(state.isPasswordResetDisabled).toBe(true)
    })
})
