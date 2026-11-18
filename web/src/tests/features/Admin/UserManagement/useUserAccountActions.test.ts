import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    appError,
    client,
    error,
    render,
    reset,
    settle,
    success,
} from './user-management-hooks.test.helpers.ts'
import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'

const deleteUser = vi.fn()
const convertAccount = vi.fn()
const setActive = vi.fn()
const resetPassword = vi.fn()
const updateProfile = vi.fn()
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    convertAccountTypeHandler: convertAccount,
    deleteUserHandler: deleteUser,
    setUserActiveHandler: setActive,
    resetUserPasswordHandler: resetPassword,
    updateUserProfileHandler: updateProfile,
}))
import useUserAccountActions from '@/features/Admin/UserManagement/Hooks/useUserAccountActions.ts'
import useUserEditor from '@/features/Admin/UserManagement/Hooks/useUserEditor.ts'

const user: UserManagementUser = {
    id: 'member',
    username: 'member',
    email: 'member@example.invalid',
    firstName: null,
    lastName: null,
    street: null,
    houseNumber: null,
    postalCode: null,
    city: null,
    isActive: true,
    isSuperUser: false,
    isCurrentUser: false,
    createdAt: '2026-01-01',
    profileImageVersion: null,
    permissions: [],
}

const useConvertiblePublicAccounts = () =>
    useUserAccountActions('public', false, true)

beforeEach(() => {
    reset()
    for (const handler of [
        deleteUser,
        convertAccount,
        setActive,
        resetPassword,
        updateProfile,
    ]) {
        handler.mockReset().mockResolvedValue({ success: true })
    }
})

describe('account actions', () => {
    it('requires confirmation before converting and blocks self and protected targets', async () => {
        const first = render(useConvertiblePublicAccounts)
        first.handler.handleAskConvertAccount({ ...user, isCurrentUser: true })
        first.handler.handleAskConvertAccount({ ...user, isSuperUser: true })
        expect(
            render(useConvertiblePublicAccounts).state.conversionTarget,
        ).toBeNull()
        first.handler.handleAskConvertAccount(user)
        let hook = render(useConvertiblePublicAccounts)
        expect(hook.state.conversionTarget).toEqual(user)
        expect(convertAccount).not.toHaveBeenCalled()
        hook.handler.handleCloseConversion()
        first.handler.handleAskConvertAccount(user)
        hook = render(useConvertiblePublicAccounts)
        hook.handler.handleConfirmConversion()
        await settle()
        expect(convertAccount).toHaveBeenCalledWith({
            data: { id: user.id, accountType: 'public' },
        })
        expect(
            render(useConvertiblePublicAccounts).state.conversionTarget,
        ).toBeNull()
    })

    it('blocks self deletion/deactivation and unauthorized super-user actions', async () => {
        const hook = render(() => useUserAccountActions('public', false, false))
        hook.handler.handleDeleteUser({ ...user, isCurrentUser: true })
        hook.handler.handleToggleUserActive({ ...user, isCurrentUser: true })
        const superUser = { ...user, isSuperUser: true }
        hook.handler.handleDeleteUser(superUser)
        hook.handler.handleToggleUserActive(superUser)
        hook.handler.onPasswordReset(superUser)
        hook.handler.handleConfirmDeleteUser()
        await settle()
        expect(error.mock.calls.map(([message]) => message)).toEqual([
            'admin.users.deleteSelfForbidden',
            'admin.users.deactivateSelfForbidden',
            'admin.users.deleteForbidden',
            'admin.users.statusForbidden',
            'admin.users.passwordResetForbidden',
        ])
        expect(deleteUser).not.toHaveBeenCalled()
        expect(setActive).not.toHaveBeenCalled()
        expect(resetPassword).not.toHaveBeenCalled()
        expect(
            render(() => useUserAccountActions('public', false, false)).state
                .deleteTargetUser,
        ).toBeNull()
    })

    it('cancels deletion, then confirms an authorized deletion and invalidates lists', async () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        let hook = render(() => useUserAccountActions('public', true, false))
        hook.handler.handleDeleteUser({ ...user, isSuperUser: true })
        hook = render(() => useUserAccountActions('public', true, false))
        expect(hook.state.deleteTargetUser?.id).toBe(user.id)
        hook.handler.handleCloseDeleteModal()
        hook = render(() => useUserAccountActions('public', true, false))
        hook.handler.handleConfirmDeleteUser()
        expect(deleteUser).not.toHaveBeenCalled()
        hook.handler.handleDeleteUser(user)
        render(() =>
            useUserAccountActions('public', true, false),
        ).handler.handleConfirmDeleteUser()
        hook = render(() => useUserAccountActions('public', true, false))
        expect(hook.state.deleteTargetUser).toBeNull()
        expect(hook.state.isDeletingUser).toBe(true)
        await settle()
        expect(deleteUser).toHaveBeenCalledWith({
            data: { accountType: 'public', id: user.id },
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: [...ADMIN_USERS_QUERY_KEY, 'public'],
        })
        expect(success).toHaveBeenCalledWith('admin.users.deleted', {
            title: 'admin.users.title',
        })
        invalidate.mockRestore()
    })

    it('updates all cached user lists after status changes and allows reactivating self', async () => {
        client.setQueryData(
            [...ADMIN_USERS_QUERY_KEY, 'public', 'restricted'],
            [user, { ...user, id: 'other' }],
        )
        client.setQueryData(
            [...ADMIN_USERS_QUERY_KEY, 'public', 'full'],
            [user],
        )
        const hook = render(() => useUserAccountActions('public', true, false))
        hook.handler.handleToggleUserActive(user)
        expect(
            render(() => useUserAccountActions('public', true, false)).state
                .isTogglingUserActive,
        ).toBe(true)
        await settle()
        expect(setActive).toHaveBeenCalledWith({
            data: { accountType: 'public', id: user.id, isActive: false },
        })
        expect(
            client
                .getQueryData<Array<UserManagementUser>>([
                    ...ADMIN_USERS_QUERY_KEY,
                    'public',
                    'restricted',
                ])
                ?.map((entry) => entry.isActive),
        ).toEqual([false, true])
        expect(
            client.getQueryData<Array<UserManagementUser>>([
                ...ADMIN_USERS_QUERY_KEY,
                'public',
                'full',
            ])?.[0]?.isActive,
        ).toBe(false)
        hook.handler.handleToggleUserActive({
            ...user,
            isCurrentUser: true,
            isActive: false,
        })
        await settle()
        expect(setActive).toHaveBeenLastCalledWith({
            data: { accountType: 'public', id: user.id, isActive: true },
        })
    })

    it('sends reset once while pending and permits an authorized super-user reset', async () => {
        const pendingRequest = Promise.withResolvers<unknown>()
        resetPassword.mockImplementation(() => pendingRequest.promise)
        render(() =>
            useUserAccountActions('public', true, false),
        ).handler.onPasswordReset({
            ...user,
            isSuperUser: true,
        })
        await Promise.resolve()
        const pending = render(() =>
            useUserAccountActions('public', true, false),
        )
        expect(pending.state.isResendingPasswordReset).toBe(true)
        pending.handler.onPasswordReset(user)
        pendingRequest.resolve({ success: true })
        await settle()
        expect(resetPassword).toHaveBeenCalledTimes(1)
        expect(resetPassword).toHaveBeenCalledWith({
            data: { accountType: 'public', id: user.id },
        })
        expect(success).toHaveBeenCalledWith('admin.users.passwordResetSent', {
            title: 'admin.users.title',
        })
    })

    it.each(['delete', 'status', 'reset'] as const)(
        'reports a rejected %s response without success',
        async (action) => {
            const adapter =
                action === 'delete'
                    ? deleteUser
                    : action === 'status'
                      ? setActive
                      : resetPassword
            adapter.mockResolvedValue({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Denied' },
            })
            let hook = render(() =>
                useUserAccountActions('public', true, false),
            )
            if (action === 'delete') {
                hook.handler.handleDeleteUser(user)
                hook = render(() =>
                    useUserAccountActions('public', true, false),
                )
                hook.handler.handleConfirmDeleteUser()
            } else if (action === 'status')
                hook.handler.handleToggleUserActive(user)
            else hook.handler.onPasswordReset(user)
            await settle()
            expect(appError).toHaveBeenCalledTimes(1)
            expect(success).not.toHaveBeenCalled()
        },
    )

    it.each([
        ['delete', new Error('network'), 'network'],
        ['delete', null, 'admin.users.deleteError'],
        ['status', new Error('network'), 'network'],
        ['status', null, 'admin.users.statusUpdateError'],
        ['reset', new Error('network'), 'network'],
        ['reset', null, 'admin.users.passwordResetError'],
    ] as const)(
        'reports transport failures for %s',
        async (action, reason, message) => {
            const adapter =
                action === 'delete'
                    ? deleteUser
                    : action === 'status'
                      ? setActive
                      : resetPassword
            adapter.mockRejectedValue(reason)
            let hook = render(() =>
                useUserAccountActions('public', false, false),
            )
            if (action === 'delete') {
                hook.handler.handleDeleteUser(user)
                hook = render(() =>
                    useUserAccountActions('public', false, false),
                )
                hook.handler.handleConfirmDeleteUser()
            } else if (action === 'status')
                hook.handler.handleToggleUserActive(user)
            else hook.handler.onPasswordReset(user)
            await settle()
            expect(error).toHaveBeenCalledWith(message, {
                title: 'common.error',
            })
            expect(success).not.toHaveBeenCalled()
        },
    )
})

describe('user editor', () => {
    it('blocks unauthorized super-user edits and resets the draft on cancel', () => {
        let hook = render(() => useUserEditor('public', false))
        hook.handler.handleOpenEditModal({ ...user, isSuperUser: true })
        expect(
            render(() => useUserEditor('public', false)).state.isEditModalOpen,
        ).toBe(false)
        expect(error).toHaveBeenCalledWith('admin.users.editForbidden', {
            title: 'admin.users.title',
        })
        hook.handler.handleOpenEditModal(user)
        hook = render(() => useUserEditor('public', false))
        expect(hook.state.isEditModalOpen).toBe(true)
        expect(hook.state.editForm).toMatchObject({
            id: user.id,
            firstName: '',
            city: '',
        })
        hook.handler.handleCloseEditModal()
        hook = render(() => useUserEditor('public', false))
        expect(hook.state.isEditModalOpen).toBe(false)
        expect(hook.state.editForm.id).toBe('')
    })

    it('saves a populated profile, closes the editor and invalidates users', async () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        render(() => useUserEditor('public', true)).handler.handleOpenEditModal(
            {
                ...user,
                isSuperUser: true,
                firstName: 'Ada',
                city: 'Berlin',
            },
        )
        let hook = render(() => useUserEditor('public', true))
        const values = { ...hook.state.editForm, username: 'updated' }
        hook.handler.handleUpdateUser(values)
        expect(
            render(() => useUserEditor('public', true)).state.isUpdatingUser,
        ).toBe(true)
        await settle()
        expect(updateProfile).toHaveBeenCalledWith({
            data: { ...values, accountType: 'public' },
        })
        hook = render(() => useUserEditor('public', true))
        expect(hook.state.isEditModalOpen).toBe(false)
        expect(hook.state.editForm.id).toBe('')
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: [...ADMIN_USERS_QUERY_KEY, 'public'],
        })
        invalidate.mockRestore()
    })

    it.each(['rejected', 'network', 'unknown'])(
        'preserves an open edit draft on %s failure',
        async (failure) => {
            if (failure === 'rejected')
                updateProfile.mockResolvedValue({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Denied' },
                })
            else
                updateProfile.mockRejectedValue(
                    failure === 'network' ? new Error('offline') : null,
                )
            render(() =>
                useUserEditor('public', false),
            ).handler.handleOpenEditModal(user)
            const hook = render(() => useUserEditor('public', false))
            hook.handler.handleUpdateUser(hook.state.editForm)
            await settle()
            expect(
                render(() => useUserEditor('public', false)).state
                    .isEditModalOpen,
            ).toBe(true)
            if (failure === 'rejected')
                expect(appError).toHaveBeenCalledTimes(1)
            else
                expect(error).toHaveBeenCalledWith(
                    failure === 'network'
                        ? 'offline'
                        : 'admin.users.updateError',
                    { title: 'common.error' },
                )
            expect(success).not.toHaveBeenCalled()
        },
    )
})
