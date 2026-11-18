import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'

const storageBarrierMocks = {
    withShared: vi.fn(async function <T>(operation: () => Promise<T>) {
        return operation()
    }),
}
const backgroundStorageMocks = {
    read: vi.fn(async function (_userId: string): Promise<Buffer | null> {
        return Buffer.from('synthetic-webp')
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
        backgroundStorageMocks.read.mockResolvedValue(
            Buffer.from('synthetic-webp'),
        )
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
                }),
            )

            expect(response.status).toBe(401)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(storageBarrierMocks.withShared).not.toHaveBeenCalled()
            expect(backgroundStorageMocks.read).not.toHaveBeenCalled()
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
            expect(await response.text()).toBe(
                method === 'HEAD' ? '' : 'synthetic-webp',
            )
            expect(mockedRequireAccess).toHaveBeenCalledTimes(1)
            expect(storageBarrierMocks.withShared).toHaveBeenCalledTimes(1)
            expect(backgroundStorageMocks.read).toHaveBeenCalledTimes(1)
            expect(backgroundStorageMocks.read).toHaveBeenCalledWith(userId)
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
        },
    )

    it.each(['GET', 'HEAD'])(
        'liefert bei fehlendem Bild für %s weiterhin 404 ohne Cachefreigabe',
        async function (method) {
            backgroundStorageMocks.read.mockResolvedValue(null)

            const response = await handleCurrentUserBackground(
                new Request('https://app.example.test/api/user/background', {
                    method,
                }),
            )

            expect(response.status).toBe(404)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(backgroundStorageMocks.read).toHaveBeenCalledTimes(1)
            expect(backgroundStorageMocks.read).toHaveBeenCalledWith(userId)
        },
    )

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
