import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { PrivateStorageFileWriteInput } from '@/server/Storage/Types/private-files.types.ts'
import { CoreCommandError } from '@/server/Core/error.ts'

const write =
    vi.fn<
        (
            input: PrivateStorageFileWriteInput,
            check: () => void,
        ) => Promise<boolean>
    >()
const core = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const logError = vi.fn()
vi.mock('@/server/Storage/linux-private-write.service.ts', () => ({
    writeLinuxPrivateStorageFileService: write,
}))
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError }))
vi.mock('@/config/core.config.ts', () => ({
    CORE_RUNTIME: {
        workerMaxProcesses: 2,
        workerMaxQueueSize: 3,
        workerMaxQueuedBytes: 1800,
        maxBinaryInputBytes: 1024,
        maxRequestBytes: 1024,
        commandTimeoutMs: 100,
    },
}))
const {
    runPrivateStorageWriteService: run,
    closePrivateStorageWritesService: close,
} = await import('@/server/Storage/private-write-queue.service.ts')

const releases = new Set<() => void>()
function gate() {
    const deferred = Promise.withResolvers<void>()
    releases.add(deferred.resolve)
    return deferred
}
function input(bytes = 16): PrivateStorageFileWriteInput {
    return {
        rootDirectory: '/synthetic/private',
        filePath: '/synthetic/private/file.bin',
        data: new Uint8Array(bytes).fill(7),
    }
}
async function flush() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

beforeEach(function () {
    write.mockReset().mockResolvedValue(true)
    core.mockReset().mockResolvedValue(undefined)
    logError.mockReset()
})
afterEach(async function () {
    for (const release of releases) release()
    releases.clear()
    await close()
    vi.restoreAllMocks()
})

describe('Begrenzte direkte private Schreibvorgänge', function () {
    it('übernimmt Bytes und Pfade vor dem ersten Await und löscht den Snapshot nach Erfolg', async function () {
        const waiting = gate()
        write.mockImplementation(async () => {
            await waiting.promise
            return true
        })
        const original = input()
        const pending = run(original)
        original.data.fill(9)
        original.filePath = '/changed'
        await flush()
        const snapshot = write.mock.calls[0]![0]
        expect(snapshot.data).toEqual(new Uint8Array(16).fill(7))
        expect(snapshot.filePath).toBe('/synthetic/private/file.bin')
        waiting.resolve()
        await pending
        expect(snapshot.data).toEqual(new Uint8Array(16))
        expect(original.data).toEqual(new Uint8Array(16).fill(9))
        expect(core).not.toHaveBeenCalled()
    })

    it('begrenzt aktive und wartende Aufträge und gibt Plätze vollständig wieder frei', async function () {
        const waiting = gate()
        write.mockImplementation(async () => {
            await waiting.promise
            return true
        })
        const first = run(input())
        const second = run(input())
        const third = run(input())
        await flush()
        expect(write).toHaveBeenCalledTimes(2)
        await expect(run(input())).rejects.toMatchObject({ code: 'CORE_BUSY' })
        waiting.resolve()
        await Promise.all([first, second, third])
        expect(write).toHaveBeenCalledTimes(3)
        await run(input())
        expect(write).toHaveBeenCalledTimes(4)
    })

    it('prüft das gemeinsame Bytebudget einschließlich Metadaten vor der Aufnahme', async function () {
        const waiting = gate()
        write.mockImplementation(async () => {
            await waiting.promise
            return true
        })
        const first = run(input(1024))
        await expect(run(input(1024))).rejects.toMatchObject({
            code: 'CORE_BUSY',
        })
        await expect(run(input(1025))).rejects.toMatchObject({
            code: 'CORE_INVALID_REQUEST',
        })
        await expect(
            run({ ...input(), filePath: 'x'.repeat(1100) }),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        waiting.resolve()
        await first
        expect(write).toHaveBeenCalledTimes(1)
        await run(input(1024))
    })

    it('wechselt nur nach einer mutationsfreien Ablehnung einmal zum Core', async function () {
        write.mockResolvedValueOnce(false)
        await run(input())
        expect(core).toHaveBeenCalledTimes(1)
        expect(core.mock.calls[0]).toMatchObject([
            'storage',
            {
                operation: 'writeFile',
                rootDirectory: '/synthetic/private',
                filePath: '/synthetic/private/file.bin',
            },
            { signal: expect.any(AbortSignal), timeoutMs: expect.any(Number) },
        ])
        expect(write.mock.calls[0]![0].data).toEqual(new Uint8Array(16))
    })

    it.each([
        new CoreCommandError('EACCES', 'secret path', { uncertain: true }),
        new CoreCommandError('invalid secret code', 'secret path'),
        new Error('/secret/path', { cause: 'secret value' }),
        undefined,
    ])(
        'wiederholt Fehler niemals und entfernt private Pfade, Ursachen und unsichere Codes (%#)',
        async function (failure) {
            write.mockImplementationOnce(async () => {
                throw failure
            })
            const result = await run(input()).then(
                () => undefined,
                (error: unknown) => error,
            )
            expect(result).toBeInstanceOf(CoreCommandError)
            expect(String(result)).not.toContain('secret')
            expect(result).not.toHaveProperty('cause')
            if (
                failure instanceof CoreCommandError &&
                failure.code === 'EACCES'
            )
                expect(result).toMatchObject({
                    code: 'EACCES',
                    isUncertain: true,
                })
            else expect(result).toMatchObject({ code: 'CORE_IO_ERROR' })
            expect(core).not.toHaveBeenCalled()
            expect(logError).toHaveBeenCalledTimes(1)
            expect(
                write.mock.calls.every(([request]) =>
                    request.data.every((byte) => byte === 0),
                ),
            ).toBe(true)
        },
    )

    it('löscht abgelaufene wartende Aufträge und wartet auf bestätigte späte Ergebnisse aktiver Aufträge', async function () {
        const waiting = gate()
        let started = 0
        write.mockImplementation(async (_request, check) => {
            const checksBeforePublication = started++ === 0
            await waiting.promise
            if (checksBeforePublication) check()
            return true
        })
        const first = run(input())
        const firstError = first.then(
            () => undefined,
            (error: unknown) => error,
        )
        const second = run(input())
        const third = run(input())
        const rejected = third.then(
            () => undefined,
            (error: unknown) => error,
        )
        await flush()
        expect(await rejected).toMatchObject({ code: 'CORE_TIMEOUT' })
        expect(write).toHaveBeenCalledTimes(2)
        waiting.resolve()
        expect(await firstError).toMatchObject({ code: 'CORE_TIMEOUT' })
        await second
        expect(core).not.toHaveBeenCalled()
    })

    it('besitzt aktive Aufgaben bereits vor einem reentranten Shutdown', async function () {
        const waiting = gate()
        let closing: Promise<void> | undefined
        let finished = false
        write.mockImplementationOnce(async () => {
            closing = close().then(() => {
                finished = true
                return undefined
            })
            await waiting.promise
            return true
        })
        const pending = run(input())
        await flush()
        expect(closing).toBeDefined()
        expect(finished).toBe(false)
        waiting.resolve()
        await pending
        await closing
        expect(finished).toBe(true)
    })

    it('beendet abgebrochene aktive Aufträge erst nach ihrem vollständigen Aufräumen', async function () {
        const waiting = gate()
        write.mockImplementation(async (_request, check) => {
            await waiting.promise
            check()
            return true
        })
        const first = run(input())
        const rejected = first.then(
            () => undefined,
            (error: unknown) => error,
        )
        await flush()
        let finished = false
        const closing = close().then(() => {
            finished = true
            return undefined
        })
        await flush()
        expect(finished).toBe(false)
        await expect(run(input())).rejects.toMatchObject({
            code: 'CORE_UNAVAILABLE',
        })
        expect(write.mock.calls[0]![0].data.every((byte) => byte === 7)).toBe(
            true,
        )
        waiting.resolve()
        expect(await rejected).toMatchObject({ code: 'CORE_CANCELLED' })
        await closing
        expect(write.mock.calls[0]![0].data.every((byte) => byte === 0)).toBe(
            true,
        )
        expect(core).not.toHaveBeenCalled()
        write.mockResolvedValueOnce(true)
        await run(input())
    })

    it('wartet beim Herunterfahren auch auf den Core-Fallback und übergibt den Abbruch', async function () {
        const waiting = gate()
        write.mockResolvedValueOnce(false)
        core.mockImplementationOnce(async () => {
            await waiting.promise
        })
        const pending = run(input())
        await flush()
        expect(core).toHaveBeenCalledTimes(1)
        const closing = close()
        expect(core.mock.calls[0]?.[2]).toMatchObject({
            signal: expect.objectContaining({ aborted: true }),
        })
        waiting.resolve()
        await pending
        await closing
    })
})
