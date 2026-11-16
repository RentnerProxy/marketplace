import { beforeEach, describe, expect, it, mock } from 'bun:test'

const currentUser = mock(async (): Promise<{ id: string } | null> => ({
    id: 'current-user',
}))
const configured = mock(() => [{ id: 'google' as const, name: 'Google' }])
const rows = [
    { id: 'linked', provider: 'github', createdAt: new Date('2026-01-01') },
    { id: 'unknown', provider: 'unknown', createdAt: new Date('2026-01-02') },
]
const where = mock(() => ({ orderBy: async () => rows }))
const select = mock((_selection: unknown) => ({ from: () => ({ where }) }))
mock.module('@/db', () => ({ db: { select } }))
mock.module('@/db/Schema/socialAuth.ts', () => ({
    socialAccounts: {
        id: 'id',
        userId: 'userId',
        provider: 'provider',
        createdAt: 'createdAt',
    },
}))
mock.module('drizzle-orm', () => ({
    eq: (...values: unknown[]) => values,
    desc: (value: unknown) => value,
}))
mock.module('@/server/Auth/currentSession.ts', () => ({
    getActiveCurrentSessionUser: currentUser,
}))
mock.module('@/server/Auth/Social/config.service.ts', () => ({
    getConfiguredSocialProvidersService: configured,
}))

const { getCurrentUserSocialAccountsService } =
    await import('@/server/Auth/Social/management.service.ts')

beforeEach(() => {
    select.mockClear()
    currentUser.mockResolvedValue({ id: 'current-user' })
})

describe('Current user social accounts', () => {
    it('scopes account metadata to the authenticated user without exposing provider subjects', async () => {
        const result = await getCurrentUserSocialAccountsService()
        expect(where).toHaveBeenCalledWith(['userId', 'current-user'])
        expect(result).toEqual({
            providers: [{ id: 'google', name: 'Google' }],
            accounts: [
                {
                    id: 'linked',
                    provider: 'github',
                    createdAt: new Date('2026-01-01'),
                },
            ],
        })
        expect(select.mock.calls[0]?.[0]).toEqual({
            id: 'id',
            provider: 'provider',
            createdAt: 'createdAt',
        })
    })

    it('rejects expired or missing sessions without querying accounts', async () => {
        currentUser.mockResolvedValueOnce(null)
        await expect(getCurrentUserSocialAccountsService()).rejects.toThrow(
            'Du musst angemeldet sein.',
        )
        expect(select).not.toHaveBeenCalled()
    })
})
