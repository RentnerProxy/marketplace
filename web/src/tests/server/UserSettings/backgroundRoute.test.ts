import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import type {
    BackgroundFile,
    BackgroundFileMetadata,
} from '@/server/UserSettings/Types/background-storage.types.ts'

const storageBarrierMocks = {
    withShared: vi.fn(async function <T>(operation: () => Promise<T>) {
        return operation()
    }),
}
const file = {
    version: 'a'.repeat(64),
    size: Buffer.byteLength('synthetic-webp'),
    bytes: Buffer.from('synthetic-webp'),
}
const backgroundStorageMocks = {
    read: vi.fn(async function (
        _userId: string,
    ): Promise<BackgroundFile | null> {
        return file
    }),
    stat: vi.fn(async function (
        _userId: string,
    ): Promise<BackgroundFileMetadata | null> {
        return { version: file.version, size: file.size }
    }),
}

vi.mock('@tanstack/react-router', function () {
    return {
        createFileRoute: function () {
            return function (options: unknown) {
                return options
            }
        },
    }
})

vi.mock('@/server/Auth/authorization.service.ts', function () {
    return { requireAuthenticatedFeatureAccessService: vi.fn() }
})

vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        withSharedStorageMutationBarrier: storageBarrierMocks.withShared,
    }
})

vi.mock('@/server/UserSettings/background-storage.service.ts', function () {
    return {
        readCurrentUserBackgroundFileService: backgroundStorageMocks.read,
        statCurrentUserBackgroundFileService: backgroundStorageMocks.stat,
    }
})

const { handleCurrentUserBackground } =
    await import('@/routes/api/user/background.ts')
const mockedRequireAccess = requireAuthenticatedFeatureAccessService as Mock<
    typeof requireAuthenticatedFeatureAccessService
>
const userId = '00000000-0000-4000-8000-000000000001'
const allowedAccess = {
    sessionUser: {
        id: userId,
        username: 'synthetic-user',
        email: 'synthetic@example.test',
        accountType: 'public' as const,
        emailVerifiedAt: null,
        sessionHash: 'a'.repeat(64),
        isActive: true,
        isDeleted: false,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
    permissionKeys: [],
}

describe('geschützter Benutzerhintergrund', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        mockedRequireAccess.mockResolvedValue(allowedAccess)
        backgroundStorageMocks.read.mockResolvedValue(file)
        backgroundStorageMocks.stat.mockResolvedValue({
            version: file.version,
            size: file.size,
        })
    })

    it.each(['GET', 'HEAD'])(
        'weist nicht angemeldete %s-Zugriffe vor dem privaten Reader ab',
        async function (method) {
            mockedRequireAccess.mockRejectedValue(
                new AuthenticationRequiredError(),
            )

            const response = await handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background', {
                    method,
                    headers: { 'if-none-match': '*' },
                }),
            )

            expect(response.status).toBe(401)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(storageBarrierMocks.withShared).not.toHaveBeenCalled()
            expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
            expect(backgroundStorageMocks.stat).not.toHaveBeenCalled()
        },
    )

    it.each(['GET', 'HEAD'])(
        'liefert %s nur aus dem privaten Reader des aktuellen Nutzers',
        async function (method) {
            const response = await handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background', {
                    method,
                }),
            )

            expect(response.status).toBe(200)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-cache, must-revalidate',
            )
            expect(response.headers.get('content-type')).toBe('image/webp')
            expect(response.headers.get('content-length')).toBe(
                String(file.size),
            )
            expect(response.headers.get('etag')).toMatch(/^W\/"[a-f0-9]{64}"$/)
            expect(response.headers.get('vary')).toBe('Cookie')
            expect(await response.text()).toBe(
                method === 'HEAD' ? '' : 'synthetic-webp',
            )
            expect(mockedRequireAccess).toHaveBeenCalledTimes(1)
            expect(storageBarrierMocks.withShared).toHaveBeenCalledTimes(1)
            const loader =
                method === 'HEAD'
                    ? backgroundStorageMocks.stat
                    : backgroundStorageMocks.read
            const skipped =
                method === 'HEAD'
                    ? backgroundStorageMocks.read
                    : backgroundStorageMocks.stat
            expect(loader).toHaveBeenCalledTimes(1)
            expect(loader).toHaveBeenCalledWith(userId)
            expect(skipped).not.toHaveBeenCalled()
        },
    )

    it.each(['GET', 'HEAD'])(
        'blockiert %s vor Dateizugriff und Legacy-Migration',
        async function (method) {
            const error = new MaintenanceModeError()
            mockedRequireAccess.mockRejectedValue(error)

            const response = await handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background', {
                    method,
                    headers: { 'if-none-match': '*' },
                }),
            )

            expect(response.status).toBe(503)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(await response.text()).toBe(
                method === 'HEAD' ? '' : error.message,
            )
            expect(mockedRequireAccess).toHaveBeenCalledTimes(1)
            expect(storageBarrierMocks.withShared).not.toHaveBeenCalled()
            expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
            expect(backgroundStorageMocks.stat).not.toHaveBeenCalled()
        },
    )

    it.each(['GET', 'HEAD'])(
        'liefert bei fehlendem Bild für %s weiterhin 404 ohne Cachefreigabe',
        async function (method) {
            backgroundStorageMocks.read.mockResolvedValue(null)
            backgroundStorageMocks.stat.mockResolvedValue(null)

            const response = await handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background', {
                    method,
                    headers: { 'if-none-match': '*' },
                }),
            )

            expect(response.status).toBe(404)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(response.headers.has('etag')).toBe(false)
            expect(backgroundStorageMocks.stat).toHaveBeenCalledTimes(1)
            expect(backgroundStorageMocks.stat).toHaveBeenCalledWith(userId)
            expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
        },
    )

    it.each(['GET', 'HEAD'])(
        'revalidates %s with only authorized metadata and preserves private cache headers',
        async function (method) {
            const url = 'https://app.example.test/api/user/background'
            const first = await handleCurrentUserBackground(new Request(url))
            const etag = first.headers.get('etag')
            if (!etag) throw new Error('Expected a private background ETag')
            backgroundStorageMocks.read.mockClear()
            const response = await handleCurrentUserBackground(
                new Request(url, {
                    method,
                    headers: {
                        'if-none-match': '"unrelated", ' + etag.slice(2),
                    },
                }),
            )
            expect(response.status).toBe(304)
            expect(response.body).toBeNull()
            expect(response.headers.get('etag')).toBe(etag)
            expect(response.headers.get('vary')).toBe('Cookie')
            expect(response.headers.get('cache-control')).toBe(
                'private, no-cache, must-revalidate',
            )
            expect(storageBarrierMocks.withShared).toHaveBeenCalledTimes(2)
            expect(backgroundStorageMocks.stat).toHaveBeenCalledWith(userId)
            expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
        },
    )

    it('returns the version from the opened bytes when the file changes after the metadata check', async function () {
        const url = 'https://app.example.test/api/user/background'
        const original = await handleCurrentUserBackground(new Request(url))
        const originalEtag = original.headers.get('etag')
        if (!originalEtag) throw new Error('Expected the original ETag')
        backgroundStorageMocks.stat.mockResolvedValueOnce({
            version: 'b'.repeat(64),
            size: 5,
        })
        backgroundStorageMocks.read.mockResolvedValueOnce({
            version: 'c'.repeat(64),
            bytes: Buffer.from('new'),
            size: 3,
        })
        const response = await handleCurrentUserBackground(
            new Request(url, {
                headers: { 'if-none-match': originalEtag },
            }),
        )
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('new')
        expect(response.headers.get('content-length')).toBe('3')
        expect(response.headers.get('etag')).not.toBe(originalEtag)

        backgroundStorageMocks.stat.mockResolvedValueOnce({
            version: 'c'.repeat(64),
            size: 3,
        })
        const current = await handleCurrentUserBackground(
            new Request(url, { method: 'HEAD' }),
        )
        expect(response.headers.get('etag')).toBe(current.headers.get('etag'))
    })

    it('scopes validators to the authenticated user even for the same native version', async function () {
        const url = 'https://app.example.test/api/user/background'
        const first = await handleCurrentUserBackground(new Request(url))
        const etag = first.headers.get('etag')
        if (!etag) throw new Error('Expected an ETag')
        const otherUser = '00000000-0000-4000-8000-000000000002'
        mockedRequireAccess.mockResolvedValueOnce({
            ...allowedAccess,
            sessionUser: { ...allowedAccess.sessionUser, id: otherUser },
        })
        const second = await handleCurrentUserBackground(
            new Request(url, {
                headers: { 'if-none-match': etag },
            }),
        )
        expect(second.status).toBe(200)
        expect(second.headers.get('etag')).not.toBe(etag)
        expect(backgroundStorageMocks.stat).toHaveBeenCalledWith(otherUser)
        expect(backgroundStorageMocks.read).toHaveBeenLastCalledWith(otherUser)
    })

    it('ignoriert fremde Nutzer- und Dateipfade aus der Request-URL', async function () {
        await handleCurrentUserBackground(
            new Request(
                'https://app.example.test/api/user/background?userId=another-user&filePath=/public/background.webp',
            ),
        )

        expect(backgroundStorageMocks.read).toHaveBeenCalledTimes(1)
        expect(backgroundStorageMocks.read).toHaveBeenCalledWith(userId)
    })

    it('wartet auf Authentifizierung und die freigegebene Restore-Sperre vor dem Reader', async function () {
        const authorize = Promise.withResolvers<typeof allowedAccess>()
        const barrierEntered = Promise.withResolvers<void>()
        const releaseBarrier = Promise.withResolvers<void>()
        mockedRequireAccess.mockReturnValueOnce(authorize.promise)
        storageBarrierMocks.withShared.mockImplementationOnce(async function <
            T,
        >(operation: () => Promise<T>) {
            barrierEntered.resolve()
            await releaseBarrier.promise
            return operation()
        })

        const response = handleCurrentUserBackground(
            new Request('https://app.example.test/api/user/background'),
        )
        expect(storageBarrierMocks.withShared).not.toHaveBeenCalled()
        expect(backgroundStorageMocks.read).not.toHaveBeenCalled()

        authorize.resolve(allowedAccess)
        await barrierEntered.promise
        expect(backgroundStorageMocks.read).not.toHaveBeenCalled()

        releaseBarrier.resolve()
        expect((await response).status).toBe(200)
        expect(backgroundStorageMocks.read).toHaveBeenCalledTimes(1)
        expect(backgroundStorageMocks.read).toHaveBeenCalledWith(userId)
    })

    it('führt bei fehlgeschlagener Restore-Sperre keinen privaten Read aus', async function () {
        const error = new Error('synthetic storage barrier unavailable')
        storageBarrierMocks.withShared.mockRejectedValueOnce(error)

        await expect(
            handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background'),
            ),
        ).rejects.toBe(error)

        expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
    })

    it('behandelt einen sicheren Reader-Fehler nicht als fehlendes Bild oder Freigabe', async function () {
        const error = new Error('synthetic private image unavailable')
        backgroundStorageMocks.read.mockRejectedValueOnce(error)

        await expect(
            handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background'),
            ),
        ).rejects.toBe(error)

        expect(storageBarrierMocks.withShared).toHaveBeenCalledTimes(1)
        expect(backgroundStorageMocks.read).toHaveBeenCalledTimes(1)
        expect(backgroundStorageMocks.read).toHaveBeenCalledWith(userId)
    })

    it('behandelt fehlerhafte Zugriffsprüfung nicht als Freigabe', async function () {
        const error = new Error('synthetic policy storage unavailable')
        mockedRequireAccess.mockRejectedValue(error)

        await expect(
            handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background'),
            ),
        ).rejects.toBe(error)

        expect(storageBarrierMocks.withShared).not.toHaveBeenCalled()
        expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
    })
})
