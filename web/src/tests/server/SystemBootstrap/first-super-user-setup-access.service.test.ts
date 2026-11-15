import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'bun:test'
import { FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS } from '@/config/security.config.ts'
import {
    clearFirstSuperUserSetupAccessService,
    createFirstSuperUserSetupAccessIfMissingService,
    createFirstSuperUserSetupAccessService,
    hasValidFirstSuperUserSetupAccessService,
} from '@/server/SystemBootstrap/first-super-user-setup-access.service.ts'

function createStore() {
    let storedValue: string | null = null

    return {
        del: vi.fn(async function () {
            storedValue = null
            return 1
        }),
        get: vi.fn(async function () {
            return storedValue
        }),
        set: vi.fn(async function (
            _key: string,
            value: string,
            _expiryMode: string,
            _ttl: number,
            condition?: 'NX',
        ) {
            if (condition === 'NX' && storedValue !== null) return null
            storedValue = value
            return 'OK' as const
        }),
    }
}

describe('First-Superuser-Setup-Zugriff', function () {
    it('speichert nur den Hash mit kurzer TTL und validiert den Roh-Token', async function () {
        const store = createStore()
        const token = await createFirstSuperUserSetupAccessService(store)

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(store.set).toHaveBeenCalledWith(
            expect.any(String),
            createHash('sha256').update(token).digest('hex'),
            'EX',
            FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS,
        )
        await expect(
            hasValidFirstSuperUserSetupAccessService(token, store),
        ).resolves.toBe(true)
    })

    it('invalidiert einen zuvor erzeugten Link durch einen neuen', async function () {
        const store = createStore()
        const firstToken = await createFirstSuperUserSetupAccessService(store)
        const secondToken = await createFirstSuperUserSetupAccessService(store)

        await expect(
            hasValidFirstSuperUserSetupAccessService(firstToken, store),
        ).resolves.toBe(false)
        await expect(
            hasValidFirstSuperUserSetupAccessService(secondToken, store),
        ).resolves.toBe(true)
    })

    it('legt einen automatischen Zugang atomar mit Hash und zehn Minuten TTL an', async function () {
        const store = createStore()
        const token =
            await createFirstSuperUserSetupAccessIfMissingService(store)

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        if (!token) throw new Error('Synthetic setup access was not created')
        expect(store.set).toHaveBeenCalledWith(
            expect.any(String),
            createHash('sha256').update(token).digest('hex'),
            'EX',
            FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS,
            'NX',
        )
        await expect(
            hasValidFirstSuperUserSetupAccessService(token, store),
        ).resolves.toBe(true)
    })

    it('lässt einen noch gültigen automatisch oder manuell erzeugten Zugang unverändert', async function () {
        const store = createStore()
        const token = await createFirstSuperUserSetupAccessService(store)

        await expect(
            createFirstSuperUserSetupAccessIfMissingService(store),
        ).resolves.toBeNull()
        await expect(
            hasValidFirstSuperUserSetupAccessService(token, store),
        ).resolves.toBe(true)
    })

    it('erneuert einen abgelaufenen Zugang und lehnt den alten Token danach ab', async function () {
        const store = createStore()
        const token = await createFirstSuperUserSetupAccessService(store)
        await clearFirstSuperUserSetupAccessService(store)
        const renewed =
            await createFirstSuperUserSetupAccessIfMissingService(store)

        if (!renewed) throw new Error('Synthetic setup access was not renewed')
        await expect(
            hasValidFirstSuperUserSetupAccessService(token, store),
        ).resolves.toBe(false)
        await expect(
            hasValidFirstSuperUserSetupAccessService(renewed, store),
        ).resolves.toBe(true)
    })

    it('erzeugt bei konkurrierenden automatischen Erneuerungen nur einen gültigen Zugang', async function () {
        const store = createStore()
        const tokens = await Promise.all(
            Array.from({ length: 8 }, () =>
                createFirstSuperUserSetupAccessIfMissingService(store),
            ),
        )
        const created = tokens.filter((token) => token !== null)
        expect(created).toHaveLength(1)
        await expect(
            hasValidFirstSuperUserSetupAccessService(created[0]!, store),
        ).resolves.toBe(true)
    })

    it('gibt bei einem fehlgeschlagenen Speichervorgang keinen Zugang zurück', async function () {
        const store = createStore()
        store.set.mockRejectedValueOnce(new Error('Synthetic Valkey failure'))

        await expect(
            createFirstSuperUserSetupAccessIfMissingService(store),
        ).rejects.toThrow('Synthetic Valkey failure')
    })

    it('lehnt fehlende, falsch formatierte und falsche Tokens ab', async function () {
        const store = createStore()
        const token = await createFirstSuperUserSetupAccessService(store)

        await expect(
            hasValidFirstSuperUserSetupAccessService('', store),
        ).resolves.toBe(false)
        await expect(
            hasValidFirstSuperUserSetupAccessService('x'.repeat(43), store),
        ).resolves.toBe(false)
        await clearFirstSuperUserSetupAccessService(store)
        await expect(
            hasValidFirstSuperUserSetupAccessService(token, store),
        ).resolves.toBe(false)
    })
})
