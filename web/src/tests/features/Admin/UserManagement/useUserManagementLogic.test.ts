import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { ReactElement } from 'react'
import {
    client,
    error,
    query,
    render,
    reset,
    success,
} from './user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { UserManagementPermission } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import type { UsersTableProps } from '@/features/Admin/UserManagement/Components/UsersTable/Types/user-management-table.types.ts'

let eventListener: (event: RealtimeEvent) => void
const unsubscribe = vi.fn()
const subscribe = vi.fn((listener: typeof eventListener) => {
    eventListener = listener
    return unsubscribe
})
let actor: string | undefined = 'actor'
let superUser = false
let loading = false
let permissions: Array<UserManagementPermission> = [
    {
        id: 'dashboard',
        key: PERMISSIONS.USER_DASHBOARD,
        name: 'Dashboard',
        description: '',
    },
]
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    getPermissionsHandler: vi.fn(),
    getUsersHandler: vi.fn(),
    deleteUserHandler: vi.fn(),
    setUserActiveHandler: vi.fn(),
    resetUserPasswordHandler: vi.fn(),
    updateUserProfileHandler: vi.fn(),
}))
import useUserManagementLogic from '@/features/Admin/UserManagement/Hooks/useUserManagementLogic.ts'
import UserManagement from '@/features/Admin/UserManagement/index.tsx'

beforeEach(() => {
    reset()
    actor = 'actor'
    superUser = false
    loading = false
    permissions = [
        {
            id: 'dashboard',
            key: PERMISSIONS.USER_DASHBOARD,
            name: 'Dashboard',
            description: '',
        },
    ]
    query.mockImplementation((input: unknown) => {
        const options = input as { queryKey: Array<string> }
        return options.queryKey[0] === 'session'
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
            : { data: permissions, isLoading: loading }
    })
})

describe('account management screen', () => {
    it('connects row deletion and cancellation through the screen confirmation modal', () => {
        const screen = render(() => UserManagement({ accountType: 'public' }))
        const children = screen.props.children as Array<ReactElement>
        const table = children[0] as ReactElement<UsersTableProps>
        const user: Parameters<UsersTableProps['onDeleteUser']>[0] = {
            id: 'member',
            username: 'Ada',
            email: 'ada@example.invalid',
            firstName: null,
            lastName: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
            isActive: true,
            isSuperUser: false,
            isCurrentUser: false,
            createdAt: '2026-01-01T00:00:00Z',
            profileImageVersion: null,
            permissions: [],
        }
        table.props.onDeleteUser(user)
        const selectedChildren = render(() =>
            UserManagement({ accountType: 'public' }),
        ).props.children as Array<ReactElement>
        const modal = selectedChildren[2] as ReactElement<{
            isOpen: boolean
            question: string
            onClose: () => void
        }>
        expect(modal.props.isOpen).toBe(true)
        expect(modal.props.question).toBe('admin.users.deleteQuestion')
        modal.props.onClose()
        const closedChildren = render(() =>
            UserManagement({ accountType: 'public' }),
        ).props.children as Array<ReactElement>
        expect(
            (closedChildren[2] as ReactElement<{ isOpen: boolean }>).props
                .isOpen,
        ).toBe(false)
    })

    it('separates cached permissions by actor and visibility, hiding cached permissions from anonymous sessions', () => {
        let hook = render(() => useUserManagementLogic('public'))
        expect(hook.state.canManageSuperUsers).toBe(false)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-permissions', 'actor', 'public'],
                enabled: true,
            }),
        )
        superUser = true
        permissions = [
            {
                id: 'super',
                key: PERMISSIONS.ADMIN_SUPER_USER,
                name: 'Super',
                description: '',
            },
        ]
        hook = render(() => useUserManagementLogic('staff'))
        expect(hook.state.canManageSuperUsers).toBe(true)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-permissions', 'actor', 'staff'],
            }),
        )
        actor = undefined
        loading = true
        hook = render(() => useUserManagementLogic('public'))
        expect(hook.state.availablePermissions).toEqual([])
        expect(hook.state.canManageSuperUsers).toBe(false)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({ enabled: false }),
        )
    })

    it('refreshes users on realtime updates and deactivates revoked users in every cached list', () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        render(() => useUserManagementLogic('public'))
        render(() => useUserManagementLogic('public'))
        expect(subscribe).toHaveBeenCalledTimes(1)
        eventListener({
            type: 'admin-user.updated',
            payload: { userId: 'member' },
        } as RealtimeEvent)
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: ADMIN_USERS_QUERY_KEY,
        })
        client.setQueryData(
            [...ADMIN_USERS_QUERY_KEY, 'actor'],
            [
                { id: 'member', isActive: true },
                { id: 'other', isActive: true },
            ],
        )
        eventListener({
            type: 'admin-user.access-revoked',
            payload: { userId: 'member' },
        } as RealtimeEvent)
        expect(
            client.getQueryData([...ADMIN_USERS_QUERY_KEY, 'actor']),
        ).toEqual([
            { id: 'member', isActive: false },
            { id: 'other', isActive: true },
        ])
        invalidate.mockClear()
        eventListener({
            type: 'admin-permissions.updated',
            payload: {},
        } as RealtimeEvent)
        expect(invalidate).not.toHaveBeenCalled()
        invalidate.mockRestore()
    })
})
