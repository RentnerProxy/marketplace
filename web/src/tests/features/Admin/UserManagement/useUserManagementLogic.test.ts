import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { ReactElement } from 'react'
import {
    appError,
    client,
    error,
    query,
    render,
    reset,
    settle,
    success,
} from './user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import type { CreateUserFormValues } from '@/features/Admin/UserManagement/Types/user-management-form.types.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { UserManagementPermission } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import type { UsersTableProps } from '@/features/Admin/UserManagement/Components/UsersTable/Types/user-management-table.types.ts'

const createUser = vi.fn()
const resetForm = vi.fn()
let submit: (input: { value: CreateUserFormValues }) => Promise<void>
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
vi.mock('@tanstack/react-form', () => ({
    useForm(options: { onSubmit: typeof submit }) {
        submit = options.onSubmit
        return { reset: resetForm }
    },
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    getPermissionsHandler: vi.fn(),
    getUsersHandler: vi.fn(),
    createUserHandler: createUser,
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
    createUser.mockReset().mockResolvedValue({ success: true })
    query.mockImplementation((input: unknown) => {
        const options = input as { queryKey: Array<string> }
        return options.queryKey[0] === 'session'
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
            : { data: permissions, isLoading: loading }
    })
})

describe('user management screen and create form', () => {
    it('connects row deletion and cancellation through the screen confirmation modal', () => {
        const screen = render(UserManagement)
        const children = screen.props.children as Array<ReactElement>
        const table = children[1] as ReactElement<UsersTableProps>
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
            createdByUserId: null,
            isDefaultUser: false,
            isSuperUser: false,
            isCurrentUser: false,
            createdAt: '2026-01-01T00:00:00Z',
            profileImageVersion: null,
            permissions: [],
        }
        table.props.onDeleteUser(user)
        const selectedChildren = render(UserManagement).props
            .children as Array<ReactElement>
        const modal = selectedChildren[3] as ReactElement<{
            isOpen: boolean
            question: string
            onClose: () => void
        }>
        expect(modal.props.isOpen).toBe(true)
        expect(modal.props.question).toBe('admin.users.deleteQuestion')
        modal.props.onClose()
        const closedChildren = render(UserManagement).props
            .children as Array<ReactElement>
        expect(
            (closedChildren[3] as ReactElement<{ isOpen: boolean }>).props
                .isOpen,
        ).toBe(false)
    })

    it('separates cached permissions by actor and visibility, hiding cached permissions from anonymous sessions', () => {
        let hook = render(useUserManagementLogic)
        expect(hook.state.canManageSuperUsers).toBe(false)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-permissions', 'actor', 'restricted'],
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
        hook = render(useUserManagementLogic)
        expect(hook.state.canManageSuperUsers).toBe(true)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({
                queryKey: ['admin-permissions', 'actor', 'full'],
            }),
        )
        actor = undefined
        loading = true
        hook = render(useUserManagementLogic)
        expect(hook.state.availablePermissions).toEqual([])
        expect(hook.state.canManageSuperUsers).toBe(false)
        expect(hook.state.isLoadingPermissions).toBe(false)
        expect(query).toHaveBeenLastCalledWith(
            expect.objectContaining({ enabled: false }),
        )
    })

    it('submits an invitation, resets the form, closes a deletion modal and refreshes users', async () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        const hook = render(useUserManagementLogic)
        hook.handler.handleDeleteUser({
            id: 'pending-delete',
            isCurrentUser: false,
            isSuperUser: false,
        } as Parameters<typeof hook.handler.handleDeleteUser>[0])
        const values = { username: 'new-user', email: 'new@example.invalid' }
        await submit({ value: values })
        expect(render(useUserManagementLogic).state.isCreatingUser).toBe(true)
        await settle()
        expect(createUser).toHaveBeenCalledWith({ data: values })
        expect(resetForm).toHaveBeenCalledTimes(1)
        expect(render(useUserManagementLogic).state.deleteTargetUser).toBeNull()
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: ADMIN_USERS_QUERY_KEY,
        })
        expect(success).toHaveBeenCalledWith('admin.users.createdAndInvited', {
            title: 'admin.users.title',
        })
        invalidate.mockRestore()
    })

    it.each(['rejected', 'network', 'unknown'])(
        'keeps invitation values on %s failure',
        async (failure) => {
            if (failure === 'rejected')
                createUser.mockResolvedValue({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Denied' },
                })
            else
                createUser.mockRejectedValue(
                    failure === 'network' ? new Error('offline') : null,
                )
            render(useUserManagementLogic)
            await submit({
                value: { username: 'member', email: 'member@example.invalid' },
            })
            await settle()
            expect(resetForm).not.toHaveBeenCalled()
            expect(success).not.toHaveBeenCalled()
            if (failure === 'rejected')
                expect(appError).toHaveBeenCalledTimes(1)
            else
                expect(error).toHaveBeenCalledWith(
                    failure === 'network'
                        ? 'offline'
                        : 'admin.users.createError',
                    { title: 'common.error' },
                )
        },
    )

    it('refreshes users on realtime updates and deactivates revoked users in every cached list', () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        render(useUserManagementLogic)
        render(useUserManagementLogic)
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
