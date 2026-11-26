import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { lstat, readFile, rm, stat } from 'node:fs/promises'
import * as filesystem from 'node:fs/promises'
import path from 'node:path'
import { createWorkerProcessFixture } from './worker.test.helpers.ts'

const spawn = vi.fn()
const binary = vi.fn(async () => '/synthetic/core')
const info = vi.fn()
const failure = vi.fn()
const version = 'a'.repeat(64)
const originalRuntime = {
    ...(await import('@/config/core.config.ts')).CORE_RUNTIME,
}
const runtime = {
    ...originalRuntime,
    workerMaxProcesses: 2,
    workerMaxQueueSize: 4,
    workerMaxQueuedBytes: 512,
    workerReadyTimeoutMs: 50,
    workerIdleTimeoutMs: 1000,
    workerExitTimeoutMs: 25,
    maxBinaryInputBytes: 256,
    maxRequestBytes: 256,
    maxRecordBytes: 256,
    maxOutputBytes: 1024,
    maxErrorBytes: 64,
    commandTimeoutMs: 1000,
    cancellationGraceMs: 150,
}
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('@/server/Core/binary.service.ts', () => ({
    getCoreBinaryPathService: binary,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo: info,
    logError: failure,
}))
vi.mock('@/config/core.config.ts', () => ({ CORE_RUNTIME: runtime }))
const { runPooledCoreCommandService: run, closeCoreWorkerPoolsService: close } =
    await import('@/server/Core/worker-pool.service.ts')
type Fixture = ReturnType<typeof createWorkerProcessFixture>
let fixtures: Fixture[]
let setup: (fixture: Fixture) => void
let ready: boolean
let environments: NodeJS.ProcessEnv[]

async function until(check: () => boolean) {
    const deadline = Date.now() + 1000
    while (!check()) {
        if (Date.now() > deadline)
            throw new Error('Fixture wurde nicht rechtzeitig bereit.')
        // oxlint-disable-next-line no-await-in-loop -- Each observation depends on the previous asynchronous process event.
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    fixtures = []
    environments = []
    ready = true
    runtime.workerMaxProcesses = 2
    runtime.workerMaxQueueSize = 4
    runtime.workerMaxQueuedBytes = 512
    runtime.workerIdleTimeoutMs = 1000
    runtime.maxRecordBytes = 256
    runtime.maxOutputBytes = 1024
    runtime.maxBinaryOutputBytes = originalRuntime.maxBinaryOutputBytes
    runtime.maxBrandingInputBytes = originalRuntime.maxBrandingInputBytes
    setup = (fixture) =>
        fixture.setHandler((header) =>
            fixture.send({
                type: 'result',
                requestId: header.requestId,
                result: header.request,
            }),
        )
    binary.mockResolvedValue('/synthetic/core')
    spawn.mockImplementation((_executable, _arguments, options) => {
        const fixture = createWorkerProcessFixture()
        fixtures.push(fixture)
        environments.push(options.env)
        setup(fixture)
        if (ready)
            queueMicrotask(() => fixture.send({ type: 'ready', protocol: 1 }))
        return fixture.child
    })
})

afterEach(async () => {
    await close()
    for (const fixture of fixtures) fixture.finish()
})

describe('Persistenter Core-Pool', () => {
    it('liest binäre Antworten über Header- und Payloadgrenzen ohne Base64 und verwendet den Worker erneut', async () => {
        const data = Buffer.from([0, 255, 10, 13, 123, 34, 0, 195, 40])
        setup = (fixture) =>
            fixture.setHandler((header) => {
                if (header.requestId === 1) {
                    const frame = Buffer.from(
                        JSON.stringify({
                            type: 'binaryResult',
                            requestId: 1,
                            binaryBytes: data.length,
                            version,
                        }) + '\n',
                    )
                    fixture.child.stdout.write(frame.subarray(0, 5))
                    fixture.child.stdout.write(
                        Buffer.concat([frame.subarray(5), data.subarray(0, 2)]),
                    )
                    fixture.child.stdout.write(data.subarray(2, 5))
                    fixture.child.stdout.write(data.subarray(5))
                } else
                    fixture.send({
                        type: 'result',
                        requestId: header.requestId,
                        result: null,
                    })
            })
        const result = await run(
            'storage',
            { operation: 'readBackgroundRepresentation' },
            {
                validateResult(value) {
                    expect(value).toEqual({ version, bytes: data })
                    return value
                },
            },
        )
        expect(result).toEqual({ version, bytes: data })
        await expect(
            run('storage', { operation: 'readBackgroundRepresentation' }),
        ).resolves.toBeNull()
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
    })

    it('unterscheidet eine leere Binärdatei von einer fehlenden Datei', async () => {
        setup = (fixture) =>
            fixture.setHandler((header) =>
                fixture.send(
                    header.requestId === 1
                        ? {
                              type: 'binaryResult',
                              requestId: 1,
                              binaryBytes: 0,
                              version,
                          }
                        : {
                              type: 'result',
                              requestId: header.requestId,
                              result: null,
                          },
                ),
            )
        const empty = await run('storage', {
            operation: 'readBackgroundRepresentation',
        })
        expect(empty).toEqual({ version, bytes: Buffer.alloc(0) })
        await expect(
            run('storage', { operation: 'readBackgroundRepresentation' }),
        ).resolves.toBeNull()
    })

    it('bestätigt eine binäre Antwort erst nach vollständigem Payload und hochgeladenem Auftrag', async () => {
        setup = () => {}
        const promise = run('storage', {
            operation: 'readBackgroundRepresentation',
        })
        let settled = false
        void promise.then(() => {
            settled = true
            return undefined
        })
        await until(() => fixtures[0]?.requests.length === 1)
        const fixture = fixtures[0]!
        fixture.send({
            type: 'binaryResult',
            requestId: 1,
            binaryBytes: 3,
            version,
        })
        fixture.child.stdout.write(Buffer.from([1, 10]))
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
        expect(settled).toBe(false)
        fixture.child.stdout.write(Buffer.from([255]))
        expect(await promise).toEqual({
            version,
            bytes: Buffer.from([1, 10, 255]),
        })
    })

    it.each([
        { type: 'binaryResult', requestId: 2, binaryBytes: 0, version },
        { type: 'binaryResult', requestId: 1, binaryBytes: -1, version },
        { type: 'binaryResult', requestId: 1, binaryBytes: 0.5, version },
        { type: 'binaryResult', requestId: 1, binaryBytes: null, version },
        { type: 'binaryResult', requestId: 1, version },
        { type: 'binaryResult', requestId: 1, binaryBytes: 0 },
        {
            type: 'binaryResult',
            requestId: 1,
            binaryBytes: 0,
            version: 'A'.repeat(64),
        },
        {
            type: 'binaryResult',
            requestId: 1,
            binaryBytes: 8 * 1024 * 1024 + 1,
            version,
        },
        {
            type: 'binaryResult',
            requestId: 1,
            binaryBytes: 0,
            version,
            extra: true,
        },
        { type: 'result', requestId: 1, result: { dataBase64: 'AQID' } },
    ])(
        'verwirft ungültige binäre Antwortheader ohne Wiederholung (%j)',
        async (frame) => {
            setup = (fixture) => fixture.setHandler(() => fixture.send(frame))
            await expect(
                run('storage', { operation: 'readBackgroundRepresentation' }),
            ).rejects.toMatchObject({
                code: 'CORE_PROTOCOL_ERROR',
                isUncertain: true,
            })
            expect(spawn).toHaveBeenCalledTimes(1)
            expect(fixtures[0]!.child.kill).toHaveBeenCalledWith('SIGKILL')
        },
    )

    it('akzeptiert binäre Antworten ausschließlich für den vereinbarten Leseauftrag', async () => {
        setup = (fixture) =>
            fixture.setHandler(() =>
                fixture.send({
                    type: 'binaryResult',
                    requestId: 1,
                    binaryBytes: 0,
                    version,
                }),
            )
        await expect(
            run('storage', { operation: 'statBackground' }),
        ).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
    })

    it.each(['truncated', 'extra', 'duplicate'])(
        'bestätigt beschädigte binäre Antworten nicht (%s)',
        async (kind) => {
            setup = (fixture) =>
                fixture.setHandler(() => {
                    const header = Buffer.from(
                        `{"type":"binaryResult","requestId":1,"binaryBytes":3,"version":"${version}"}\n`,
                    )
                    const data = Buffer.from([0, 255, 10])
                    if (kind === 'truncated') {
                        fixture.child.stdout.write(
                            Buffer.concat([header, data.subarray(0, 2)]),
                        )
                        fixture.finish()
                    } else
                        fixture.child.stdout.write(
                            Buffer.concat([
                                header,
                                data,
                                Buffer.from(
                                    kind === 'extra'
                                        ? 'x'
                                        : '{"type":"result","requestId":1,"result":null}\n',
                                ),
                            ]),
                        )
                })
            await expect(
                run('storage', { operation: 'readBackgroundRepresentation' }),
            ).rejects.toMatchObject({ isUncertain: true })
            expect(spawn).toHaveBeenCalledTimes(1)
        },
    )

    it('bestätigt vollständige binäre Daten vor einem unmittelbaren Prozessende', async () => {
        setup = (fixture) =>
            fixture.setHandler(() => {
                fixture.child.stdout.write(
                    Buffer.concat([
                        Buffer.from(
                            `{"type":"binaryResult","requestId":1,"binaryBytes":3,"version":"${version}"}\n`,
                        ),
                        Buffer.from([1, 10, 255]),
                    ]),
                )
                queueMicrotask(() => fixture.finish())
            })
        await expect(
            run('storage', { operation: 'readBackgroundRepresentation' }),
        ).resolves.toEqual({ version, bytes: Buffer.from([1, 10, 255]) })
    })

    it('reapt bei abgebrochenem unvollständigem Binärpayload vor der Ablehnung und wiederholt nicht', async () => {
        setup = (fixture) =>
            fixture.setHandler(() => {
                fixture.send({
                    type: 'binaryResult',
                    requestId: 1,
                    binaryBytes: 3,
                    version,
                })
                fixture.child.stdout.write(Buffer.from([1]))
            })
        const controller = new AbortController()
        const result = run(
            'storage',
            { operation: 'readBackgroundRepresentation' },
            { signal: controller.signal, timeoutMs: 10000 },
        )
        // Observe rejection without invoking Bun's async matcher before aborting.
        const outcome = result.then(
            () => ({ rejected: false, error: undefined }),
            (error: unknown) => ({ rejected: true, error }),
        )
        await until(() => fixtures[0]?.requests.length === 1)
        controller.abort(new Error('partial binary cancelled'))
        const settled = await outcome
        expect(settled.rejected).toBe(true)
        expect(settled.error).toMatchObject({ isUncertain: true })
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(fixtures[0]!.child.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('überträgt Branding als begrenzten dreiteiligen Snapshot im selben Worker', async () => {
        const data = new Uint8Array([1, 2, 3, 0, 10, 255])
        const result = run(
            'storage',
            { operation: 'brandingPublish', binaryLengths: [1, 2, 3] },
            { binaryInput: data },
        )
        data.fill(7)
        await result
        expect(fixtures[0]!.requests[0]!.bytes).toEqual(
            Buffer.from([1, 2, 3, 0, 10, 255]),
        )
        expect(fixtures[0]!.requests[0]!.header.binaryBytes).toBe(6)
        expect(fixtures[0]!.requests[0]!.header.request).not.toHaveProperty(
            'largeBase64',
        )
        expect(fixtures[0]!.written[1]).toEqual(Buffer.alloc(6))
    })

    it.each([
        { operation: 'brandingPublish', binaryLengths: [1, 1] },
        {
            operation: 'brandingPublish',
            binaryLengths: Object.assign([], { 0: 1, 2: 2 }),
        },
        { operation: 'brandingPublish', binaryLengths: [0, 1, 2] },
        { operation: 'brandingPublish', binaryLengths: [257, 1, 1] },
        { operation: 'brandingPublish', binaryLengths: [1.5, 1, 0.5] },
        {
            operation: 'brandingPublish',
            binaryLengths: [1, 1, 1],
            largeBase64: null,
        },
        { operation: 'brandingPublish', binaryLengths: [1, 1, 2] },
        { operation: 'writeFile', binaryLengths: [1, 1, 1] },
    ])(
        'weist widersprüchliche Multipart-Metadaten vor Admission zurück (%j)',
        async (request) => {
            await expect(
                run('storage', request, { binaryInput: new Uint8Array(3) }),
            ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
            expect(spawn).not.toHaveBeenCalled()
        },
    )

    it('verwirft Branding-Längen ohne Nutzdaten und ein überschrittenes Gesamtlimit vor Admission', async () => {
        await expect(
            run('storage', {
                operation: 'brandingPublish',
                binaryLengths: [1, 1, 1],
            }),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        runtime.maxBrandingInputBytes = 2
        await expect(
            run(
                'storage',
                { operation: 'brandingPublish', binaryLengths: [1, 1, 1] },
                { binaryInput: new Uint8Array(3) },
            ),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        expect(spawn).not.toHaveBeenCalled()
    })

    it('balanciert Referenzen bereits referenzierter Spawn-Pipes beim ersten Auftrag und bei Wiederverwendung', async () => {
        await run('storage', {})
        const fixture = fixtures[0]!
        expect(fixture.child.ref).not.toHaveBeenCalled()
        expect(fixture.child.stdout.ref).not.toHaveBeenCalled()
        expect(fixture.child.stderr.ref).not.toHaveBeenCalled()
        expect(fixture.child.stdout.unref).toHaveBeenCalledTimes(1)
        expect(fixture.child.stderr.unref).toHaveBeenCalledTimes(1)
        await run('storage', {})
        expect(fixture.child.ref).toHaveBeenCalledTimes(1)
        expect(fixture.child.stdout.ref).toHaveBeenCalledTimes(1)
        expect(fixture.child.stderr.ref).toHaveBeenCalledTimes(1)
        expect(fixture.child.stdout.unref).toHaveBeenCalledTimes(2)
        expect(fixture.child.stderr.unref).toHaveBeenCalledTimes(2)
        await close()
        expect(fixture.child.stdout.ref).toHaveBeenCalledTimes(2)
        expect(fixture.child.stderr.ref).toHaveBeenCalledTimes(2)
    })

    it('verwendet einen Prozess mit fortlaufenden IDs und privaten Abbruchpfaden erneut', async () => {
        await expect(
            run('storage', { operation: 'permissions' }),
        ).resolves.toEqual({ operation: 'permissions' })
        await run('storage', { operation: 'permissions' })
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(spawn.mock.calls[0]?.[1]).toEqual(['worker'])
        expect(spawn.mock.calls[0]?.[2].windowsHide).toBe(true)
        const requests = fixtures[0]!.requests
        expect(requests.map(({ header }) => header.requestId)).toEqual([1, 2])
        expect(path.isAbsolute(requests[0]!.header.cancellationPath)).toBe(true)
        expect(requests[0]!.header.cancellationPath).not.toBe(
            requests[1]!.header.cancellationPath,
        )
        const directory = path.dirname(requests[0]!.header.cancellationPath)
        expect((await stat(directory)).isDirectory()).toBe(true)
        expect(info).not.toHaveBeenCalled()
        expect(failure).not.toHaveBeenCalled()
        expect(fixtures[0]!.child.unref).toHaveBeenCalled()
        await close()
        await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('überträgt kopierte Rohdaten ohne Base64 und erhält explizite Null-Längen', async () => {
        const bytes = new Uint8Array([0, 255, 10, 34])
        const result = run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: bytes },
        )
        bytes.fill(7)
        await result
        await run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: new Uint8Array() },
        )
        expect(fixtures[0]!.requests[0]!.bytes).toEqual(
            Buffer.from([0, 255, 10, 34]),
        )
        expect(fixtures[0]!.written[1]).toEqual(Buffer.alloc(4))
        expect(bytes).toEqual(new Uint8Array([7, 7, 7, 7]))
        expect(
            fixtures[0]!.requests.map(({ header }) => header.binaryBytes),
        ).toEqual([4, 0])
        expect(fixtures[0]!.requests[0]!.header.request).not.toHaveProperty(
            'dataBase64',
        )
    })

    it('leitet ausschließlich erlaubte Umgebungswerte weiter und trennt beide Binaries', async () => {
        await run('storage', {})
        await run('archive', {})
        expect(spawn).toHaveBeenCalledTimes(2)
        const allowed = new Set([
            'PATH',
            'Path',
            'SystemRoot',
            'WINDIR',
            'ProgramFiles',
            'TEMP',
            'TMP',
            'TMPDIR',
            'LANG',
            'LC_ALL',
            'USERPROFILE',
        ])
        expect(
            Object.keys(environments[0]!).every((key) => allowed.has(key)),
        ).toBe(true)
        await expect(
            run('storage', {}, { environment: { DATABASE_URL: 'synthetic' } }),
        ).rejects.toMatchObject({ code: 'CORE_INVALID_REQUEST' })
        await expect(
            run('storage', {}, { onProgress() {} }),
        ).rejects.toMatchObject({ code: 'CORE_INVALID_REQUEST' })
    })

    it('prüft binäre und JSON-Grenzen vor dem Start und vor einer Kopie', async () => {
        await expect(
            run(
                'storage',
                { operation: 'writeFile' },
                { binaryInput: new Uint8Array(257) },
            ),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        await expect(
            run(
                'archive',
                { operation: 'writeFile' },
                { binaryInput: new Uint8Array() },
            ),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        await expect(
            run(
                'storage',
                { operation: 'writeFile', dataBase64: '' },
                { binaryInput: new Uint8Array() },
            ),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        await expect(
            run('storage', { data: 'x'.repeat(300) }),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        await expect(
            run(
                'storage',
                {},
                { signal: AbortSignal.abort(new Error('vorher')) },
            ),
        ).rejects.toThrow('vorher')
        expect(spawn).not.toHaveBeenCalled()
    })

    it('begrenzt Prozesse und alle zugelassenen Aufträge einschließlich Warteschlange', async () => {
        setup = () => {}
        const pending = Array.from({ length: 4 }, () => run('storage', {}))
        await until(
            () =>
                fixtures.length === 2 &&
                fixtures.every((fixture) => fixture.requests.length === 1),
        )
        await expect(run('storage', {})).rejects.toMatchObject({
            code: 'CORE_BUSY',
        })
        expect(spawn).toHaveBeenCalledTimes(2)
        fixtures[0]!.send({ type: 'result', requestId: 1, result: 1 })
        await until(() => fixtures[0]!.requests.length === 2)
        fixtures[0]!.send({ type: 'result', requestId: 2, result: 2 })
        await until(() => fixtures[0]!.requests.length === 3)
        fixtures[0]!.send({ type: 'result', requestId: 3, result: 3 })
        fixtures[1]!.send({ type: 'result', requestId: 1, result: 4 })
        await Promise.all(pending)
    })

    it('zählt Rohdaten und JSON gemeinsam gegen das Pool-Speicherlimit', async () => {
        setup = () => {}
        runtime.workerMaxQueuedBytes = 300
        const first = run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: new Uint8Array(200) },
        )
        await until(() => fixtures[0]?.requests.length === 1)
        await expect(
            run(
                'storage',
                { operation: 'writeFile' },
                { binaryInput: new Uint8Array(100) },
            ),
        ).rejects.toMatchObject({ code: 'CORE_BUSY' })
        fixtures[0]!.send({ type: 'result', requestId: 1, result: null })
        await first
        fixtures[0]!.setHandler((header) =>
            fixtures[0]!.send({
                type: 'result',
                requestId: header.requestId,
                result: null,
            }),
        )
        await expect(
            run('storage', { operation: 'permissions' }),
        ).resolves.toBeNull()
    })

    it('entfernt abgebrochene Wartende ohne Übertragung und zählt deren Deadline ab Admission', async () => {
        setup = () => {}
        runtime.workerMaxProcesses = 1
        const first = run('storage', {})
        await until(() => fixtures[0]?.requests.length === 1)
        const controller = new AbortController()
        const cancelled = run(
            'storage',
            { waiting: true },
            { signal: controller.signal },
        )
        controller.abort(new Error('wartend'))
        await expect(cancelled).rejects.toThrow('wartend')
        await expect(
            run('storage', { timed: true }, { timeoutMs: 5 }),
        ).rejects.toMatchObject({ code: 'CORE_TIMEOUT', isUncertain: false })
        fixtures[0]!.send({ type: 'result', requestId: 1, result: null })
        await first
        expect(fixtures[0]!.requests).toHaveLength(1)
    })

    it('verhindert Übertragung nach einem Abbruch während des Starts', async () => {
        ready = false
        const controller = new AbortController()
        const result = run('storage', {}, { signal: controller.signal })
        await until(() => fixtures.length === 1)
        controller.abort(new Error('Start abgebrochen'))
        await expect(result).rejects.toThrow('Start abgebrochen')
        fixtures[0]!.send({ type: 'ready', protocol: 1 })
        await until(() => fixtures[0]!.child.unref.mock.calls.length > 0)
        expect(fixtures[0]!.requests).toHaveLength(0)
    })

    it('setzt einen privaten Marker, wartet auf bestätigten Abbruch und verwendet den Worker erneut', async () => {
        setup = () => {}
        const controller = new AbortController()
        const pending = run('storage', {}, { signal: controller.signal })
        await until(() => fixtures[0]?.requests.length === 1)
        const cancellationPath =
            fixtures[0]!.requests[0]!.header.cancellationPath
        controller.abort(new Error('aktiv'))
        await until(() => true)
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
        expect(await readFile(cancellationPath, 'utf8')).toBe('')
        fixtures[0]!.send({
            type: 'error',
            requestId: 1,
            error: { code: 'CORE_CANCELLED', message: 'Abgebrochen.' },
        })
        await expect(pending).rejects.toThrow('aktiv')
        await expect(stat(cancellationPath)).rejects.toMatchObject({
            code: 'ENOENT',
        })
        fixtures[0]!.setHandler((header) =>
            fixtures[0]!.send({
                type: 'result',
                requestId: header.requestId,
                result: 2,
            }),
        )
        await expect(run('storage', {})).resolves.toBe(2)
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
    })

    it('erhält bestätigte späte Commit-Ergebnisse trotz Abbruch', async () => {
        setup = () => {}
        const controller = new AbortController()
        const pending = run('storage', {}, { signal: controller.signal })
        await until(() => fixtures[0]?.requests.length === 1)
        controller.abort(new Error('zu spät'))
        fixtures[0]!.send({
            type: 'result',
            requestId: 1,
            result: { recovery: 'committed' },
        })
        await expect(pending).resolves.toEqual({ recovery: 'committed' })
    })

    it('erzwingt nach Ablauf der Abbruchfrist das Ende, ohne Mutation erneut zu versuchen', async () => {
        await run('storage', { operation: 'permissions' })
        fixtures[0]!.setHandler(() => {})
        const pending = run('storage', {}, { timeoutMs: 5 })
        await expect(pending).rejects.toMatchObject({
            code: 'CORE_OPERATION_UNCERTAIN',
            isUncertain: true,
        })
        expect(fixtures[0]!.child.kill).toHaveBeenCalledWith('SIGKILL')
        expect(spawn).toHaveBeenCalledTimes(1)
        await expect(
            stat(
                path.dirname(fixtures[0]!.requests[1]!.header.cancellationPath),
            ),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it.each([
        { type: 'result', requestId: 2, result: null },
        { type: 'result', result: null },
        { type: 'result', requestId: 1, result: null, extra: true },
        { type: 'ready', protocol: 1 },
    ])(
        'vergiftet Worker bei fehlerhafter Korrelation oder Form (%j)',
        async (frame) => {
            setup = (fixture) => fixture.setHandler(() => fixture.send(frame))
            await expect(run('storage', {})).rejects.toMatchObject({
                code: 'CORE_PROTOCOL_ERROR',
                isUncertain: true,
            })
            expect(fixtures[0]!.child.kill).toHaveBeenCalled()
        },
    )

    it.each([
        'duplicate',
        'partial',
        'invalid',
        'record',
        'output',
        'stderr',
        'utf8',
        'fragmented-record',
        'fragmented-utf8',
    ])('verwirft beschädigte oder übergroße Ausgaben (%s)', async (kind) => {
        setup = (fixture) =>
            fixture.setHandler(() => {
                if (kind === 'duplicate')
                    fixture.child.stdout.write(
                        '{"type":"result","requestId":1,"result":1}\n{"type":"result","requestId":1,"result":2}\n',
                    )
                if (kind === 'partial')
                    fixture.child.stdout.write(
                        '{"type":"result","requestId":1,"result":1}\nx',
                    )
                if (kind === 'invalid') fixture.child.stdout.write('invalid\n')
                if (kind === 'record')
                    fixture.child.stdout.write('x'.repeat(257))
                if (kind === 'output')
                    fixture.child.stdout.write('x'.repeat(1025))
                if (kind === 'stderr')
                    fixture.child.stderr.write('x'.repeat(65))
                if (kind === 'utf8')
                    fixture.child.stdout.write(Buffer.from([0xff, 10]))
                if (kind === 'fragmented-record') {
                    fixture.child.stdout.write('x'.repeat(128))
                    fixture.child.stdout.write('x'.repeat(129))
                }
                if (kind === 'fragmented-utf8') {
                    fixture.child.stdout.write(
                        Buffer.from(
                            '{"type":"result","requestId":1,"result":"',
                        ),
                    )
                    fixture.child.stdout.write(Buffer.from([0xc3]))
                    fixture.child.stdout.write(
                        Buffer.from([0x28, 0x22, 0x7d, 10]),
                    )
                }
            })
        await expect(run('storage', {})).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
    })

    it('liest große fragmentierte UTF-8-Ergebnisse über Zeichengrenzen und verwendet den Worker danach erneut', async () => {
        runtime.maxRecordBytes = 4 * 1024 * 1024
        runtime.maxOutputBytes = 8 * 1024 * 1024
        const result = 'Öäü€🙂'.repeat(100_000)
        setup = (fixture) =>
            fixture.setHandler((header) => {
                if (header.requestId !== 1) {
                    fixture.send({
                        type: 'result',
                        requestId: header.requestId,
                        result: 'erneut bestätigt',
                    })
                    return
                }
                const record = Buffer.from(
                    JSON.stringify({
                        type: 'result',
                        requestId: header.requestId,
                        result,
                    }) + '\n',
                )
                for (let offset = 0; offset < record.length; offset += 8191) {
                    fixture.child.stdout.write(
                        record.subarray(offset, offset + 8191),
                    )
                }
            })
        await expect(run('storage', {})).resolves.toBe(result)
        await expect(run('storage', {})).resolves.toBe('erneut bestätigt')
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(
            fixtures[0]!.requests.map(({ header }) => header.requestId),
        ).toEqual([1, 2])
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
    })

    it('gibt Fachfehler normal zurück und verwirft unsichere Fehler erst nach Prozessende', async () => {
        setup = (fixture) =>
            fixture.setHandler((header) =>
                fixture.send({
                    type: 'error',
                    requestId: header.requestId,
                    error: { code: 'EACCES', message: 'Zugriff verweigert.' },
                }),
            )
        await expect(
            run('storage', { operation: 'permissions' }),
        ).rejects.toMatchObject({ code: 'EACCES', isUncertain: false })
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
        fixtures[0]!.setHandler((header) =>
            fixtures[0]!.send({
                type: 'error',
                requestId: header.requestId,
                error: {
                    code: 'STORAGE_ROLLBACK_FAILED',
                    message: 'Rollback unsicher.',
                },
            }),
        )
        await expect(run('storage', {})).rejects.toMatchObject({
            code: 'STORAGE_ROLLBACK_FAILED',
            isUncertain: true,
        })
        expect(fixtures[0]!.child.kill).toHaveBeenCalled()
        expect(failure).toHaveBeenCalledTimes(2)
    })

    it('bestätigt keinen Abschluss bei einem Prozessabsturz', async () => {
        setup = (fixture) => fixture.setHandler(() => fixture.finish(1))
        await expect(run('storage', {})).rejects.toMatchObject({
            code: 'CORE_OPERATION_UNCERTAIN',
            isUncertain: true,
        })
        expect(spawn).toHaveBeenCalledTimes(1)
    })

    it('erhält einen vollständigen Terminalrecord vor einem unmittelbaren Prozessende', async () => {
        setup = (fixture) =>
            fixture.setHandler((header) => {
                setImmediate(() => {
                    fixture.send({
                        type: 'result',
                        requestId: header.requestId,
                        result: { committed: true },
                    })
                    fixture.finish(1)
                })
            })
        await expect(run('storage', {})).resolves.toEqual({ committed: true })
    })

    it('wechselt bei einer neuen Binary-Konfiguration den Pool und drainiert frühere Aufträge', async () => {
        const previousDirectory = process.env.CORE_BINARY_DIR
        try {
            process.env.CORE_BINARY_DIR = '/synthetic/first'
            setup = () => {}
            const previous = run('storage', {})
            await until(() => fixtures[0]?.requests.length === 1)
            process.env.CORE_BINARY_DIR = '/synthetic/second'
            setup = (fixture) =>
                fixture.setHandler((header) =>
                    fixture.send({
                        type: 'result',
                        requestId: header.requestId,
                        result: 2,
                    }),
                )
            await expect(run('storage', {})).resolves.toBe(2)
            expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
            fixtures[0]!.send({ type: 'result', requestId: 1, result: 1 })
            await expect(previous).resolves.toBe(1)
            await until(() => fixtures[0]!.child.stdin.writableFinished)
            expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
            expect(spawn).toHaveBeenCalledTimes(2)
            expect(binary).toHaveBeenCalledTimes(2)
        } finally {
            if (previousDirectory === undefined)
                delete process.env.CORE_BINARY_DIR
            else process.env.CORE_BINARY_DIR = previousDirectory
        }
    })

    it('verweigert rekursives Cleanup bei veränderter Verzeichnisidentität und meldet den Fehler', async () => {
        await run('storage', {})
        const directory = path.dirname(
            fixtures[0]!.requests[0]!.header.cancellationPath,
        )
        const identity = await lstat(directory)
        const inspect = vi.spyOn(filesystem, 'lstat').mockResolvedValueOnce(
            Object.assign(Object.create(identity) as typeof identity, {
                dev: -1,
            }),
        )
        try {
            await close()
            expect((await stat(directory)).isDirectory()).toBe(true)
            expect(
                failure.mock.calls.some(
                    (call) => call[0] === 'core.worker_cleanup_failed',
                ),
            ).toBe(true)
        } finally {
            inspect.mockRestore()
            expect(
                path.basename(directory).startsWith('marketplace-core-worker-'),
            ).toBe(true)
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('beendet auch einen während des Starts heruntergefahrenen Pool ohne Übertragung', async () => {
        ready = false
        const bytes = new Uint8Array([9, 8, 7])
        const result = run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: bytes },
        ).catch((error: unknown) => error)
        await until(() => fixtures.length === 1)
        const closing = close()
        expect(await result).toMatchObject({ code: 'CORE_CANCELLED' })
        fixtures[0]!.send({ type: 'ready', protocol: 1 })
        await closing
        expect(fixtures[0]!.requests).toHaveLength(0)
        expect(fixtures[0]!.child.stdin.writableFinished).toBe(true)
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
        expect(bytes).toEqual(new Uint8Array([9, 8, 7]))
    })

    it('behält binäre Uploads bis zum bestätigten Ende trotz aktivem Shutdown', async () => {
        let fixture!: Fixture
        setup = (created) => {
            fixture = created
            fixture.block()
        }
        const bytes = new Uint8Array([1, 2, 3])
        const result = run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: bytes },
        )
        const outcome = result.catch((error: unknown) => error)
        await until(() => fixtures.length === 1)
        await new Promise<void>((resolve) => setImmediate(resolve))
        const closing = close()
        fixture.setHandler((header, uploaded) => {
            expect(uploaded).toEqual(Buffer.from([1, 2, 3]))
            fixture.send({
                type: 'result',
                requestId: header.requestId,
                result: { committed: true },
            })
        })
        fixture.release()
        await closing
        expect(await outcome).toEqual({ committed: true })
        expect(fixture.written[1]).toEqual(Buffer.alloc(3))
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('wartet auf echte Schreibbereitschaft vor Rohdaten und Wiederverwendung', async () => {
        setup = (fixture) => {
            fixture.block()
            fixture.setHandler((header) =>
                fixture.send({
                    type: 'result',
                    requestId: header.requestId,
                    result: null,
                }),
            )
        }
        const pending = run(
            'storage',
            { operation: 'writeFile' },
            { binaryInput: new Uint8Array([1, 2, 3]) },
        )
        await until(() => fixtures.length === 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        expect(fixtures[0]!.requests).toHaveLength(0)
        fixtures[0]!.release()
        await expect(pending).resolves.toBeNull()
        expect(fixtures[0]!.requests[0]!.bytes).toEqual(Buffer.from([1, 2, 3]))
    })

    it('begrenzt Startbereitschaft und entfernt unbenutzte Prozesse über die Idle-Frist', async () => {
        ready = false
        await expect(run('storage', {})).rejects.toMatchObject({
            code: 'CORE_UNAVAILABLE',
        })
        expect(fixtures[0]!.child.kill).toHaveBeenCalled()
        ready = true
        runtime.workerIdleTimeoutMs = 5
        await run('storage', {})
        await until(() => fixtures[1]!.child.stdin.writableFinished)
        expect(fixtures[1]!.child.kill).not.toHaveBeenCalled()
        await run('storage', {})
        expect(spawn).toHaveBeenCalledTimes(3)
    })

    it('kills a worker that stays alive after closing stdin', async function () {
        await run('storage', {})
        const fixture = fixtures[0]!
        fixture.stallOnEof()
        await close()
        expect(fixture.child.stdin.writableFinished).toBe(true)
        expect(fixture.child.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('prüft Ergebnisse und beendet bei ungültigen Resultaten den Worker', async () => {
        await expect(
            run(
                'storage',
                {},
                {
                    validateResult() {
                        throw new Error('ungültig')
                    },
                },
            ),
        ).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
        expect(fixtures[0]!.child.stdin.writableFinished).toBe(true)
        expect(fixtures[0]!.child.kill).not.toHaveBeenCalled()
    })

    it('beendet Wartende und aktive Aufträge beim expliziten Herunterfahren', async () => {
        setup = () => {}
        runtime.workerMaxProcesses = 1
        const active = run('storage', {})
        const waiting = run('storage', {})
        const activeCheck = active.catch((error: unknown) => error)
        const waitingCheck = waiting.catch((error: unknown) => error)
        await until(() => fixtures[0]?.requests.length === 1)
        await close()
        expect(await activeCheck).toMatchObject({ isUncertain: true })
        expect(await waitingCheck).toMatchObject({ code: 'CORE_CANCELLED' })
        expect(fixtures[0]!.child.kill).toHaveBeenCalled()
    })
})
