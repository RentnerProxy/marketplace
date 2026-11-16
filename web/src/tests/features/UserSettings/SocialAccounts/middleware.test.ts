import { beforeEach, describe, expect, it, mock } from 'bun:test'

const access = mock(async () => ({}))
const proof = {
    userId: 'current-user',
    sessionHash: 'session',
    credentialVersion: 'version',
}
const reauthenticate = mock(async () => ({
    success: true,
    proof,
    error: 'Invalid confirmation',
}))
const begin = mock(async () => ({ url: 'https://provider.example/authorize' }))
const accounts = mock(async () => ({ providers: [], accounts: [] }))

mock.module('@tanstack/react-start', () => ({
    createServerFn: () => ({
        handler: (handler: () => Promise<unknown>) => handler,
        validator: (validate: (data: unknown) => unknown) => ({
            handler:
                (handler: (input: { data: unknown }) => Promise<unknown>) =>
                async (input: { data: unknown }) =>
                    handler({ data: validate(input.data) }),
        }),
    }),
}))
mock.module('@/server/Auth/authorization.service.ts', () => ({
    requireAuthenticatedFeatureAccessService: access,
}))
mock.module('@/server/Auth/reauthentication.service.ts', () => ({
    reauthenticateCurrentUserService: reauthenticate,
}))
mock.module('@/server/Auth/Social/flow.service.ts', () => ({
    beginSocialAuthorizationService: begin,
}))
mock.module('@/server/Auth/Social/management.service.ts', () => ({
    getCurrentUserSocialAccountsService: accounts,
}))

const { beginSocialLinkHandler, getSocialAccountsHandler } =
    await import('@/features/UserSettings/SocialAccounts/middleware.ts')

beforeEach(() => {
    access.mockClear()
    access.mockResolvedValue({})
    reauthenticate.mockClear()
    reauthenticate.mockResolvedValue({
        success: true,
        proof,
        error: 'Invalid confirmation',
    })
    begin.mockClear()
    accounts.mockClear()
})

describe('Social account boundaries', () => {
    it('requires authenticated feature access before listing accounts', async () => {
        access.mockRejectedValueOnce(new Error('Authentication required'))
        await expect(getSocialAccountsHandler()).rejects.toThrow(
            'Authentication required',
        )
        expect(accounts).not.toHaveBeenCalled()
    })

    it('passes fresh password proof to the staged authorization flow', async () => {
        const reauthentication = {
            method: 'password' as const,
            credential: 'test-password',
        }
        await expect(
            beginSocialLinkHandler({
                data: { provider: 'google', reauthentication },
            }),
        ).resolves.toEqual({
            success: true,
            url: 'https://provider.example/authorize',
        })
        expect(access).toHaveBeenCalledTimes(1)
        expect(reauthenticate).toHaveBeenCalledWith(reauthentication)
        expect(begin).toHaveBeenCalledWith('google', proof)
    })

    it('does not initiate linking after failed reauthentication', async () => {
        reauthenticate.mockResolvedValueOnce({
            success: false,
            error: 'Invalid confirmation',
            proof,
        })
        await expect(
            beginSocialLinkHandler({
                data: {
                    provider: 'github',
                    reauthentication: { method: 'totp', credential: '123456' },
                },
            }),
        ).resolves.toMatchObject({ success: false })
        expect(begin).not.toHaveBeenCalled()
    })

    it.each(['unknown', 'apple', 'facebook', 'microsoft'])(
        'rejects unsupported provider %s before delegation',
        async (provider) => {
            await expect(
                beginSocialLinkHandler({
                    data: {
                        provider,
                        reauthentication: {
                            method: 'password',
                            credential: 'test-password',
                        },
                    } as never,
                }),
            ).rejects.toThrow()
            expect(access).not.toHaveBeenCalled()
            expect(begin).not.toHaveBeenCalled()
        },
    )
})
