import { beforeEach, describe, expect, it, vi } from 'bun:test'

const pooled = vi.fn(async () => 'pooled')
const isolated = vi.fn(async () => 'isolated')
vi.mock('@/server/Core/worker-pool.service.ts', () => ({
    runPooledCoreCommandService: pooled,
}))
vi.mock('@/server/Core/one-shot.service.ts', () => ({
    runOneShotCoreCommandService: isolated,
}))
const { runCoreCommandService: run } =
    await import('@/server/Core/command.service.ts')

beforeEach(() => vi.clearAllMocks())

describe('Core-Aufträge nach Laufzeit und Isolation', () => {
    it.each(['readBackgroundBytes', 'backupDeleteFiles'])(
        'verwendet den privaten Pool für %s',
        async (operation) => {
            expect(await run('storage', { operation })).toBe('pooled')
            expect(isolated).not.toHaveBeenCalled()
        },
    )

    it('behält Branding-Rohdaten im normalen Workerpfad binär', async () => {
        const binaryInput = new Uint8Array([0, 10, 255])
        const request = {
            operation: 'brandingPublish',
            binaryLengths: [1, 1, 1],
        }
        const options = { binaryInput }
        expect(await run('storage', request, options)).toBe('pooled')
        expect(pooled).toHaveBeenCalledWith('storage', request, options)
        expect(isolated).not.toHaveBeenCalled()
    })

    it('erhält das Legacy-Brandingformat bei ausdrücklich angeforderter Prozessisolation', async () => {
        const options = {
            environment: {},
            binaryInput: new Uint8Array([0, 10, 255]),
        }
        await run(
            'storage',
            {
                operation: 'brandingPublish',
                rootDirectory: '/synthetic',
                binaryLengths: [1, 1, 1],
            },
            options,
        )
        expect(isolated).toHaveBeenCalledWith(
            'storage',
            {
                operation: 'brandingPublish',
                rootDirectory: '/synthetic',
                largeBase64: 'AA==',
                smallBase64: 'Cg==',
                faviconBase64: '/w==',
            },
            options,
        )
        expect(pooled).not.toHaveBeenCalled()
    })

    it('weist mehrdeutige isolierte Binärformate und nicht unterstützte Antwortkanäle vor dem Start zurück', async () => {
        await Promise.all(
            [
                { operation: 'brandingPublish', binaryLengths: [1, 1, 1] },
                { operation: 'readBackgroundBytes' },
            ].map((request) =>
                expect(
                    run('storage', request, { environment: {} }),
                ).rejects.toMatchObject({ code: 'CORE_INVALID_REQUEST' }),
            ),
        )
        expect(isolated).not.toHaveBeenCalled()
        expect(pooled).not.toHaveBeenCalled()
    })

    it('verwendet kurze Storage-Aufträge mit rohen Dateibytes im Worker', async () => {
        const data = new Uint8Array([0, 10, 255])
        const request = { operation: 'writeFile', filePath: '/synthetic/file' }
        expect(await run('storage', request, { binaryInput: data })).toBe(
            'pooled',
        )
        expect(pooled).toHaveBeenCalledWith('storage', request, {
            binaryInput: data,
        })
        expect(isolated).not.toHaveBeenCalled()
    })

    it.each(['fenceAdmitShared', 'fenceAcquireExclusive', 'fenceDrain'])(
        'hält blockierende Sperraufträge außerhalb der Slots für Freigaben (%s)',
        async (operation) => {
            expect(await run('storage', { operation })).toBe('isolated')
            expect(pooled).not.toHaveBeenCalled()
        },
    )

    it('lässt Ressourcenfreigaben einen kurzen Worker verwenden', async () => {
        expect(await run('storage', { operation: 'fenceRelease' })).toBe(
            'pooled',
        )
    })

    it('erhält die Prozessisolation für explizite Umgebungsvariablen', async () => {
        const options = { environment: { SYNTHETIC_SETTING: 'fixture' } }
        const request = { operation: 'restoreStateGet' }
        expect(await run('storage', request, options)).toBe('isolated')
        expect(isolated).toHaveBeenCalledWith('storage', request, options)
        expect(pooled).not.toHaveBeenCalled()
    })

    it('erhält die unabhängige Fortschritts- und Abbruchbehandlung langer Aufträge', async () => {
        const options = { onProgress: async () => undefined }
        expect(
            await run('archive', { operation: 'validateKey' }, options),
        ).toBe('isolated')
        expect(await run('archive', { operation: 'extract' })).toBe('isolated')
        expect(pooled).not.toHaveBeenCalled()
    })

    it('erhält auch für binäre Schreibaufträge explizite Prozessumgebungen', async () => {
        const options = {
            binaryInput: new Uint8Array([1, 2, 3]),
            environment: {},
        }
        await run('storage', { operation: 'writeFile' }, options)
        expect(isolated).toHaveBeenCalledWith(
            'storage',
            { operation: 'writeFile', dataBase64: 'AQID' },
            options,
        )
        expect(pooled).not.toHaveBeenCalled()
    })

    it.each([
        ['archive', { operation: 'create' }, new Uint8Array()],
        ['storage', { operation: 'remove' }, new Uint8Array()],
        [
            'storage',
            { operation: 'writeFile', dataBase64: 'AQ==' },
            new Uint8Array(),
        ],
        [
            'storage',
            { operation: 'writeFile' },
            new Uint8Array(8 * 1024 * 1024 + 1),
        ],
        [
            'storage',
            {
                operation: 'brandingPublish',
                binaryLengths: Object.assign([], {
                    0: 1,
                    2: 2,
                }),
            },
            new Uint8Array(3),
        ],
    ] as const)(
        'verwirft widersprüchliche binäre Einzelaufträge',
        async (binary, request, binaryInput) => {
            await expect(
                run(binary, request, { binaryInput, environment: {} }),
            ).rejects.toMatchObject({ code: 'CORE_INVALID_REQUEST' })
            expect(isolated).not.toHaveBeenCalled()
            expect(pooled).not.toHaveBeenCalled()
        },
    )
})
