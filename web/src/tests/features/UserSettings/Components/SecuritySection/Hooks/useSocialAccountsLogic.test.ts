import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

const session = {
    data: { user: { id: 'user-1', isTwoFactorEnabled: false } },
    isLoading: false,
}
const refetch = mock(async () => ({}))
const accounts = {
    refetch,
    data: {
        providers: [{ id: 'google', name: 'Google' }],
        accounts: [{ provider: 'github' }],
    },
    isLoading: false,
    isError: false,
}
const reauthentication = {
    state: {
        isReauthenticationReady: true,
        reauthenticationMethod: 'password',
        reauthenticationValue: 'test-password',
    },
    handler: {
        createReauthenticationInput: () => ({
            method: reauthentication.state.reauthenticationMethod,
            credential: reauthentication.state.reauthenticationValue,
        }),
        handleReauthenticationValueChange: mock(),
        resetReauthenticationValue: mock(),
    },
}
type Mutation = {
    mutationFn: (provider: SocialProviderId) => Promise<string | void>
    onSuccess: (url: string) => void | Promise<void>
    onError: (error: unknown) => unknown
    onSettled: () => void
}
let mutation: Mutation
let unlinkMutation: Mutation
let mutationIndex = 0
const unlinkMutate = mock()
const unlinkReset = mock()
const unlink = mock(async (_input: unknown) => ({
    success: true,
    error: 'Confirmation failed',
}))
const errors = mock()
const success = mock()
const mutate = mock()
const reset = mock()
const begin = mock(async (_input: unknown) => ({
    success: true,
    url: 'https://provider.example/auth',
    error: 'Confirmation failed',
}))
const assign = mock()
mock.module('@tanstack/react-query', () => ({
    useQuery: (options: { queryKey: string[] }) =>
        options.queryKey[0] === 'session' ? session : accounts,
    useMutation: (options: Mutation) => {
        if (mutationIndex++ % 2 === 1) {
            unlinkMutation = options
            return {
                isPending: false,
                mutate: unlinkMutate,
                reset: unlinkReset,
                variables: undefined,
            }
        }
        mutation = options
        return { isPending: false, mutate, reset }
    },
}))
mock.module('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
}))
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Hooks/useCurrentUserReauthentication.ts',
    () => ({ default: () => reauthentication }),
)
mock.module('@/features/UserSettings/SocialAccounts/middleware.ts', () => ({
    beginSocialLinkHandler: begin,
    unlinkSocialAccountHandler: unlink,
    getSocialAccountsHandler: mock(),
}))
mock.module('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: errors,
}))

mock.module('@rentnerkev/toasts', () => ({ toast: { success } }))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('react', () => ({ useRef: () => ({ current: false }) }))

const { default: useSocialAccountsLogic } =
    await import('@/features/UserSettings/Components/SecuritySection/Hooks/useSocialAccountsLogic.ts')

beforeEach(() => {
    mutationIndex = 0
    unlinkMutate.mockClear()
    unlinkReset.mockClear()
    unlink.mockClear()
    errors.mockClear()
    success.mockClear()
    refetch.mockClear()
    mutate.mockClear()
    reset.mockClear()
    assign.mockClear()
    begin.mockClear()
    reauthentication.state.reauthenticationMethod = 'password'
    reauthentication.state.reauthenticationValue = 'test-password'
    reauthentication.state.isReauthenticationReady = true
    reauthentication.handler.resetReauthenticationValue.mockClear()
    stubTestGlobal('window', { location: { assign } })
})
afterEach(restoreTestGlobals)

describe('Social account linking hook', () => {
    it('shows existing connections even when their provider is no longer configured', () => {
        expect(useSocialAccountsLogic().state.providers).toEqual([
            { id: 'google', name: 'Google', isConnected: false },
            { id: 'github', name: 'GitHub', isConnected: true },
        ])
    })

    it('only starts an unlinked configured provider after confirmation is ready', () => {
        const logic = useSocialAccountsLogic()
        logic.handler.handleConnect('discord')
        logic.handler.handleConnect('github')
        expect(mutate).not.toHaveBeenCalled()
        logic.handler.handleConnect('google')
        expect(mutate).toHaveBeenCalledWith('google')
        mutate.mockClear()
        reauthentication.state.isReauthenticationReady = false
        useSocialAccountsLogic().handler.handleConnect('google')
        expect(mutate).not.toHaveBeenCalled()
    })

    it('delegates the proof request, redirects and clears confirmation material', async () => {
        useSocialAccountsLogic()
        const url = await mutation.mutationFn('google')
        expect(begin).toHaveBeenCalledWith({
            data: {
                provider: 'google',
                reauthentication: {
                    method: 'password',
                    credential: 'test-password',
                },
            },
        })
        mutation.onSuccess(url as string)
        expect(assign).toHaveBeenCalledWith('https://provider.example/auth')
        mutation.onSettled()
        expect(
            reauthentication.handler.resetReauthenticationValue,
        ).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
    })

    it('does not accept a failed confirmation as an authorization URL', async () => {
        begin.mockResolvedValueOnce({
            success: false,
            url: '',
            error: 'Confirmation failed',
        })
        useSocialAccountsLogic()
        await expect(mutation.mutationFn('google')).rejects.toThrow(
            'Confirmation failed',
        )
        expect(assign).not.toHaveBeenCalled()
    })
})

describe('Social account unlinking hook', () => {
    it('blocks unconnected providers, missing confirmation and duplicate submissions', () => {
        const logic = useSocialAccountsLogic()
        logic.handler.handleDisconnect('google')
        expect(unlinkMutate).not.toHaveBeenCalled()
        logic.handler.handleDisconnect('github')
        logic.handler.handleDisconnect('github')
        logic.handler.handleConnect('google')
        expect(unlinkMutate).toHaveBeenCalledTimes(1)
        expect(mutate).not.toHaveBeenCalled()
        reauthentication.state.isReauthenticationReady = false
        useSocialAccountsLogic().handler.handleDisconnect('github')
        expect(unlinkMutate).toHaveBeenCalledTimes(1)
    })
    it('confirms unlink, refreshes accounts, reports success and clears secrets', async () => {
        useSocialAccountsLogic()
        await unlinkMutation.mutationFn('github')
        expect(unlink).toHaveBeenCalledWith({
            data: {
                provider: 'github',
                reauthentication: {
                    method: 'password',
                    credential: 'test-password',
                },
            },
        })
        await unlinkMutation.onSuccess('')
        expect(refetch).toHaveBeenCalledTimes(1)
        expect(success).toHaveBeenCalledWith('auth.social.unlinked', {
            title: 'userSettings.header.title',
        })
        unlinkMutation.onSettled()
        expect(
            reauthentication.handler.resetReauthenticationValue,
        ).toHaveBeenCalledTimes(1)
        expect(unlinkReset).toHaveBeenCalledTimes(1)
    })
    it('reports failed confirmation and API failures without refresh or success', async () => {
        useSocialAccountsLogic()
        unlink.mockResolvedValueOnce({
            success: false,
            error: 'Confirmation failed',
        })
        await expect(unlinkMutation.mutationFn('github')).rejects.toThrow(
            'Confirmation failed',
        )
        unlink.mockRejectedValueOnce(new Error('Request failed'))
        await expect(unlinkMutation.mutationFn('github')).rejects.toThrow(
            'Request failed',
        )
        const error = new Error('Request failed')
        unlinkMutation.onError(error)
        expect(errors).toHaveBeenCalledWith(error)
        expect(refetch).not.toHaveBeenCalled()
        expect(success).not.toHaveBeenCalled()
        unlinkMutation.onSettled()
        expect(
            reauthentication.handler.resetReauthenticationValue,
        ).toHaveBeenCalledTimes(1)
    })
})

it('passes TOTP confirmation and releases duplicate protection after a failed operation', async () => {
    reauthentication.state.reauthenticationMethod = 'totp'
    reauthentication.state.reauthenticationValue = '123456'
    const logic = useSocialAccountsLogic()
    logic.handler.handleDisconnect('github')
    await unlinkMutation.mutationFn('github')
    expect(unlink).toHaveBeenCalledWith({
        data: {
            provider: 'github',
            reauthentication: { method: 'totp', credential: '123456' },
        },
    })
    unlinkMutation.onSettled()
    logic.handler.handleDisconnect('github')
    expect(unlinkMutate).toHaveBeenCalledTimes(2)
})
