import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createQueuedDatabase } from './social-db.test.helpers.ts'

const database = createQueuedDatabase()
const userId = '019f72d1-dc60-7040-bdac-9e201573f002'
const version = 'a'.repeat(64)
const mocks = {
    stat: vi.fn(
        async (_userId: string) =>
            ({ version, size: 3 }) as {
                version: string
                size: number
            } | null,
    ),
    read: vi.fn(
        async (_userId: string) =>
            ({
                version,
                size: 3,
                bytes: Buffer.from([1, 2, 3]),
            }) as { version: string; size: number; bytes: Buffer } | null,
    ),
}

vi.mock('@/db', () => ({ db: database.db }))
vi.mock('@/lib/Auth/tokens.ts', () => ({
    createTokenHashSync: (value: string) => `hash(${value})`,
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    withSharedStorageMutationBarrier: (operation: () => unknown) => operation(),
}))
vi.mock('@/server/UserSettings/background-storage.service.ts', () => ({
    statCurrentUserBackgroundFileService: mocks.stat,
    readCurrentUserBackgroundFileService: mocks.read,
}))

const { handlePublicProfileBannerService } =
    await import('@/server/Social/banner.service.ts')

function request(method = 'GET', headers: Record<string, string> = {}) {
    return new Request('https://market.example.test/banner', {
        method,
        headers,
    })
}

const etag = `W/"hash(profile-banner-v1:${userId}:${version})"`

beforeEach(() => {
    database.reset()
    vi.clearAllMocks()
})

describe('public profile banner', () => {
    it('rejects malformed ids before touching storage or the database', async () => {
        const response = await handlePublicProfileBannerService(
            request(),
            '../../etc/passwd',
        )
        expect(response.status).toBe(404)
        expect(database.calls).toHaveLength(0)
        expect(mocks.read).not.toHaveBeenCalled()
    })

    it('hides banners of deleted or inactive accounts', async () => {
        database.queue([])
        const response = await handlePublicProfileBannerService(
            request(),
            userId,
        )
        expect(response.status).toBe(404)
        expect(mocks.read).not.toHaveBeenCalled()
    })

    it('serves the banner publicly with a validator', async () => {
        database.queue([{ id: userId }])
        const response = await handlePublicProfileBannerService(
            request(),
            userId,
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/webp')
        expect(response.headers.get('cache-control')).toContain('public')
        expect(response.headers.get('etag')).toBe(etag)
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            new Uint8Array([1, 2, 3]),
        )
    })

    it('answers conditional and HEAD requests from metadata only', async () => {
        database.queue([{ id: userId }])
        const notModified = await handlePublicProfileBannerService(
            request('GET', { 'if-none-match': etag }),
            userId,
        )
        expect(notModified.status).toBe(304)
        database.queue([{ id: userId }])
        const head = await handlePublicProfileBannerService(
            request('HEAD'),
            userId,
        )
        expect(head.status).toBe(200)
        expect(head.headers.get('content-length')).toBe('3')
        expect(mocks.read).not.toHaveBeenCalled()
    })

    it('returns 404 when the account has no banner', async () => {
        mocks.read.mockResolvedValueOnce(null)
        database.queue([{ id: userId }])
        const response = await handlePublicProfileBannerService(
            request(),
            userId,
        )
        expect(response.status).toBe(404)
    })
})
