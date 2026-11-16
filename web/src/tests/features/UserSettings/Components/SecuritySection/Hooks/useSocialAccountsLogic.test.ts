import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { restoreTestGlobals, stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

const session = { data: { user: { id: 'user-1', isTwoFactorEnabled: false } }, isLoading: false }
const accounts = { data: { providers: [{ id: 'google', name: 'Google' }], accounts: [{ provider: 'github' }] }, isLoading: false, isError: false }
const reauthentication = {
    state: { isReauthenticationReady: true, reauthenticationMethod: 'password', reauthenticationValue: 'test-password' },
    handler: {
        createReauthenticationInput: () => ({ method: 'password', credential: 'test-password' }),
        handleReauthenticationValueChange: mock(),
        resetReauthenticationValue: mock(),
    },
}
let mutation: {
    mutationFn: (provider: SocialProviderId) => Promise<string>
    onSuccess: (url: string) => void
    onError: (error: unknown) => unknown
    onSettled: () => void
}
const mutate = mock()
const reset = mock()
const begin = mock(async (_input: unknown) => ({ success: true, url: 'https://provider.example/auth', error: 'Confirmation failed' }))
const assign = mock()
mock.module('@tanstack/react-query', () => ({
    useQuery: (options: { queryKey: string[] }) => options.queryKey[0] === 'session' ? session : accounts,
    useMutation: (options: typeof mutation) => {
        mutation = options
        return { isPending: false, mutate, reset }
    },
}))
mock.module('@/lib/Queries/appQueries.ts', () => ({ authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }) }))
mock.module('@/features/UserSettings/Components/SecuritySection/Hooks/useCurrentUserReauthentication.ts', () => ({ default: () => reauthentication }))
mock.module('@/features/UserSettings/SocialAccounts/middleware.ts', () => ({ beginSocialLinkHandler: begin, getSocialAccountsHandler: mock() }))
mock.module('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: mock() }))

const { default: useSocialAccountsLogic } = await import('@/features/UserSettings/Components/SecuritySection/Hooks/useSocialAccountsLogic.ts')

beforeEach(() => {
    mutate.mockClear()
    reset.mockClear()
    assign.mockClear()
    begin.mockClear()
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
        expect(begin).toHaveBeenCalledWith({ data: { provider: 'google', reauthentication: { method: 'password', credential: 'test-password' } } })
        mutation.onSuccess(url)
        expect(assign).toHaveBeenCalledWith('https://provider.example/auth')
        mutation.onSettled()
        expect(reauthentication.handler.resetReauthenticationValue).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
    })

    it('does not accept a failed confirmation as an authorization URL', async () => {
        begin.mockResolvedValueOnce({ success: false, url: '', error: 'Confirmation failed' })
        useSocialAccountsLogic()
        await expect(mutation.mutationFn('google')).rejects.toThrow('Confirmation failed')
        expect(assign).not.toHaveBeenCalled()
    })
})
