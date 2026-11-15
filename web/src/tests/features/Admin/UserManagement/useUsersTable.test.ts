import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { query, render, reset } from './user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import type { UsersTableProps } from '@/features/Admin/UserManagement/Components/UsersTable/Types/user-management-table.types.ts'

type TableOptions = {
    data: Array<UserManagementUser>
    getRowId: (user: UserManagementUser) => string
    globalFilterFn: (
        row: { original: UserManagementUser },
        columnId: string,
        value: unknown,
    ) => boolean
    initialSorting: Array<{ id: string; desc: boolean }>
}
let options: TableOptions
const search = vi.fn()
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
    createdByUserId: null,
    isDefaultUser: false,
    isSuperUser: false,
    isCurrentUser: false,
    createdAt: '2026-01-01T00:00:00Z',
    profileImageVersion: null,
    permissions: [PERMISSIONS.USER_DASHBOARD],
}
vi.mock('@/shared/Table/Hooks/useClientTable.ts', () => ({
    default(input: TableOptions) {
        options = input
        return {
            table: {},
            state: { searchInput: 'draft search' },
            handler: { handleSearchInputChange: search },
        }
    },
}))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    getUsersHandler: vi.fn(),
}))
vi.mock('@/features/Admin/UserManagement/Components/UserAvatar.tsx', () => ({
    default: ({ username }: { username: string }) =>
        createElement('img', { alt: username }),
}))
import useUsersTableViewLogic from '@/features/Admin/UserManagement/Components/UsersTable/Hooks/useUsersTableViewLogic.ts'
import UsersTable from '@/features/Admin/UserManagement/Components/UsersTable/index.tsx'
import useUserTableActionsLogic from '@/features/Admin/UserManagement/Components/UsersTable/Hooks/useUserTableActionsLogic.ts'

const props: UsersTableProps = {
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
const useView = () => useUsersTableViewLogic(props)

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
                                ? [PERMISSIONS.ADMIN_SUPER_USER]
                                : [],
                        }
                      : undefined,
              }
            : { data: [user], isLoading: false, isFetching: fetching }
    })
})

function descendants(
    node: ReactNode,
): Array<ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap(descendants)
    if (!isValidElement<Record<string, unknown>>(node)) return []
    return [node, ...descendants(node.props.children as ReactNode)]
}
describe('users table view', () => {
    it('wires table search and the loading state through its visible table controls', () => {
        fetching = true
        const tree = render(() => UsersTable(props))
        const nodes = descendants(tree)
        const toolbar = nodes.find(
            (node) => typeof node.props.onChange === 'function',
        )
        const onChange = toolbar?.props.onChange
        if (typeof onChange !== 'function')
            throw new Error('Missing search control')
        onChange('Ada')
        expect(search).toHaveBeenCalledWith('Ada')
        const body = nodes.find((node) => 'loadingState' in node.props)
        expect(body?.props.isLoading).toBe(true)
        expect(body?.props.loadingState).toEqual({
            description: 'admin.users.loading',
        })
    })

    it('offers sorted unique permission filters and toggles the column filter panel', () => {
        let hook = render(useView)
        expect(hook.state.columnFilterConfigs.permissions).toMatchObject({
            type: 'select',
            options: [
                { value: 'a.read', label: 'a.read' },
                { value: 'm.read', label: 'm.read' },
                { value: 'z.read', label: 'z.read' },
            ],
        })
        expect(hook.state.showColumnFilters).toBe(false)
        hook.handler.handleToggleColumnFilters()
        hook = render(useView)
        expect(hook.state.showColumnFilters).toBe(true)
        hook.handler.handleSearchInputChange('Ada')
        expect(search).toHaveBeenCalledWith('Ada')
        expect(options.initialSorting).toEqual([
            { id: 'createdAt', desc: true },
        ])
        expect(options.getRowId(user)).toBe(user.id)
    })

    it.each(['  ADA ', 'EXAMPLE.INVALID', 'augusta', 'LOVELACE', '', '   '])(
        'finds users by %s across identity fields',
        (value) => {
            render(useView)
            expect(options.globalFilterFn({ original: user }, '', value)).toBe(
                true,
            )
            expect(
                options.globalFilterFn(
                    { original: { ...user, firstName: null, lastName: null } },
                    '',
                    'missing',
                ),
            ).toBe(false)
        },
    )

    it('uses actor/visibility-specific queries, exposes background loading and hides anonymous cached rows', () => {
        render(useView)
        expect(options.data).toEqual([user])
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-users', 'actor', 'restricted'],
                enabled: true,
            }),
        )
        superUser = true
        fetching = true
        expect(render(useView).state.isLoadingUsers).toBe(true)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-users', 'actor', 'full'],
            }),
        )
        actor = undefined
        render(useView)
        expect(options.data).toEqual([])
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({ enabled: false }),
        )
    })

    it('renders user identity, rights, status, dates and forwards actions for the selected row', () => {
        const hook = render(useView)
        function cell(index: number, original = user) {
            const renderer = hook.state.columns[index]?.cell as (
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
        const permissionColumn = hook.state.columns[2]
        const filter = permissionColumn?.filterFn as (
            row: unknown,
            columnId: string,
            value: string,
        ) => boolean
        const row = { getValue: () => user.permissions }
        expect(filter(row, 'permissions', PERMISSIONS.USER_DASHBOARD)).toBe(
            true,
        )
        expect(filter(row, 'permissions', PERMISSIONS.ADMIN_SUPER_USER)).toBe(
            false,
        )
        const statusColumn = hook.state.columns[3]
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
