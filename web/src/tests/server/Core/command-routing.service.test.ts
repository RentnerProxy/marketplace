import { beforeEach, describe, expect, it, vi } from 'bun:test'

const pooled = vi.fn(async () => 'pooled')
const isolated = vi.fn(async () => 'isolated')
const native = vi.fn<() => Promise<unknown> | undefined>()
vi.mock('@/server/Core/native-storage.service.ts', () => ({
    tryRunNativeStorageCommandService: native,
}))
vi.mock('@/server/Core/worker-pool.service.ts', () => ({
    runPooledCoreCommandService: pooled,
}))
vi.mock('@/server/Core/one-shot.service.ts', () => ({
    runOneShotCoreCommandService: isolated,
}))
const { runCoreCommandService: run } =
    await import('@/server/Core/command.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    native.mockReset()
})

describe('Core-Aufträge nach Laufzeit und Isolation', () => {
    it('uses the native result for eligible short storage commands', async () => {
        native.mockReturnValueOnce(Promise.resolve('native'))
        const request = { operation: 'capacity', requests: [] }
        const options = {}
        expect(await run('storage', request, options)).toBe('native')
        expect(native).toHaveBeenCalledWith(request, options)
        expect(pooled).not.toHaveBeenCalled()
    })

    it('propagates a rejected native operation without executing it again', async () => {
        const failure = new Error('native operation was uncertain')
        native.mockImplementationOnce(() => Promise.reject(failure))
        await expect(
            run('storage', { operation: 'restoreStateGet' }),
        ).rejects.toBe(failure)
        expect(pooled).not.toHaveBeenCalled()
        expect(isolated).not.toHaveBeenCalled()
    })

    it.each(['readBackgroundRepresentation', 'backupDeleteFiles'])(
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

    it('weist mehrdeutige isolierte Binärformate und nicht unterstützte Antwortkanäle vor dem Start zurück', async () => {
        await Promise.all(
            [
                { operation: 'brandingPublish', binaryLengths: [1, 1, 1] },
                { operation: 'readBackgroundRepresentation' },
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

    it.each(['fenceAcquireExclusive', 'fenceDrain'])(
        'hält blockierende Sperraufträge außerhalb der Slots für Freigaben (%s)',
        async (operation) => {
            expect(await run('storage', { operation })).toBe('isolated')
            expect(native).not.toHaveBeenCalled()
            expect(pooled).not.toHaveBeenCalled()
        },
    )

    it.each(['fenceAdmitShared', 'fenceRelease'])(
        'uses a pooled worker for the short %s operation',
        async (operation) => {
            expect(await run('storage', { operation })).toBe('pooled')
        },
    )

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

    it.each([
        ['storage', { operation: 'writeFile' }, new Uint8Array([0, 10, 255])],
        [
            'storage',
            { operation: 'brandingPublish', binaryLengths: [1, 1, 1] },
            new Uint8Array([0, 10, 255]),
        ],
        ['archive', { operation: 'create' }, new Uint8Array()],
        ['storage', { operation: 'remove' }, new Uint8Array()],
    ] as const)(
        'rejects binary input for isolated %s commands',
        async (binary, request, binaryInput) => {
            await expect(
                run(binary, request, { binaryInput, environment: {} }),
            ).rejects.toMatchObject({ code: 'CORE_INVALID_REQUEST' })
            expect(isolated).not.toHaveBeenCalled()
            expect(pooled).not.toHaveBeenCalled()
        },
    )
})
