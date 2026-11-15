import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createCoreProcessFixture } from './command.test.helpers.ts'

const binary = vi.fn(async () => '/synthetic/core')
const spawn = vi.fn()
const failed = vi.fn()
const lifecycle = vi.fn()
const actualConfig = {
    ...(await import('@/config/core.config.ts')).CORE_RUNTIME,
}
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('@/server/Core/binary.service.ts', () => ({
    getCoreBinaryPathService: binary,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo: lifecycle,
    logError: failed,
}))
vi.mock('@/config/core.config.ts', () => ({
    CORE_RUNTIME: {
        ...actualConfig,
        maxSessionRecordBytes: 256,
        maxSessionPendingRequests: 3,
        maxOutputBytes: 1024,
        maxErrorBytes: 64,
        sessionCommandTimeoutMs: 150,
        commandTimeoutMs: 2000,
        cancellationGraceMs: 20,
    },
}))
const { openCoreSessionService: open } =
    await import('@/server/Core/session.service.ts')
let fixture: ReturnType<typeof createCoreProcessFixture>
let environment: NodeJS.ProcessEnv
let requests: Record<string, unknown>[]
let receive: (request: Record<string, unknown>) => void

function ack() {
    fixture.send({
        type: 'result',
        requestId: requests.at(-1)?.requestId,
        result: { ok: true },
    })
}
function validate(value: unknown) {
    if (
        !value ||
        typeof value !== 'object' ||
        !('ok' in value) ||
        value.ok !== true
    )
        throw new Error('invalid ACK')
    return value.ok
}
function start(options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    return open(
        'storage',
        ['journal-session'],
        { operation: 'journalStart', masterKeyBase64: 'synthetic' },
        { validateReady: validate, ...options },
    )
}
function normalResponse(request: Record<string, unknown>) {
    ack()
    if (request.operation === 'journalClose') fixture.finish()
}
beforeEach(() => {
    vi.clearAllMocks()
    binary.mockResolvedValue('/synthetic/core')
    fixture = createCoreProcessFixture()
    requests = []
    receive = normalResponse
    let input = ''
    fixture.child.stdin.on('data', (bytes) => {
        input += bytes.toString()
        let end = input.indexOf('\n')
        while (end !== -1) {
            const request: Record<string, unknown> = JSON.parse(
                input.slice(0, end),
            )
            input = input.slice(end + 1)
            requests.push(request)
            receive(request)
            end = input.indexOf('\n')
        }
    })
    fixture.child.stdin.on('finish', () => fixture.finish(1))
    spawn.mockImplementation((_binary, _args, options) => {
        environment = options.env
        return fixture.child
    })
})
afterEach(() => fixture.finish())

describe('retained-handle Core session transport', () => {
    it('shares one private process across start, append and confirmed close', async () => {
        const session = await start()
        expect(
            await session.request(
                { operation: 'journalAppend', event: 'applied' },
                validate,
            ),
        ).toBe(true)
        await session.close({ operation: 'journalClose' }, validate)
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(spawn.mock.calls[0]?.[1]).toEqual(['journal-session'])
        expect(spawn.mock.calls[0]?.[2].windowsHide).toBe(true)
        expect(requests.map((request) => request.operation)).toEqual([
            'journalStart',
            'journalAppend',
            'journalClose',
        ])
        expect(environment.AUTH_ENCRYPTION_KEY).toBeUndefined()
        expect(environment.DATABASE_URL).toBeUndefined()
        await expect(
            stat(path.dirname(environment.MARKETPLACE_CORE_CANCEL_FILE!)),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(failed).not.toHaveBeenCalled()
        expect(lifecycle.mock.calls.map((call) => call[0])).toEqual([
            'core.storage_session_started',
            'core.storage_session_completed',
        ])
    })

    it('serializes queued appends and waits for them before close', async () => {
        receive = (request) => {
            if (request.event === 'rewind-ready') setTimeout(ack, 10)
            else normalResponse(request)
        }
        const session = await start()
        await Promise.all([
            session.request(
                { operation: 'journalAppend', event: 'rewind-ready' },
                validate,
            ),
            session.request(
                { operation: 'journalAppend', event: 'applied' },
                validate,
            ),
            session.close({ operation: 'journalClose' }, validate),
        ])
        expect(
            requests.map((request) => request.event ?? request.operation),
        ).toEqual(['journalStart', 'rewind-ready', 'applied', 'journalClose'])
    })

    it.each([
        'not-json\n',
        '\n',
        '{"type":"progress","progress":1}\n',
        '{"type":"result","result":null,"extra":true}\n',
        'x'.repeat(257),
    ])(
        'poisons a malformed or unsolicited startup response',
        async (output) => {
            receive = () => {
                fixture.child.stdout.write(output)
            }
            await expect(start()).rejects.toMatchObject({
                code: 'CORE_PROTOCOL_ERROR',
                isUncertain: true,
            })
            expect(failed).toHaveBeenCalledTimes(1)
        },
    )

    it('rejects duplicate ACKs rather than assigning one to the next request', async () => {
        receive = () => {
            ack()
            ack()
        }
        const session = await start()
        await expect(
            session.request({ operation: 'journalAppend' }, validate),
        ).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
        await session.abort()
    })

    it('bounds UTF-8 response bytes and diagnostics without logging raw data', async () => {
        receive = () => {
            fixture.child.stdout.write('ü'.repeat(129))
        }
        await expect(start()).rejects.toMatchObject({ isUncertain: true })
        fixture = createCoreProcessFixture()
        // A separate child models diagnostics arriving before any ready ACK.
        fixture.child.stdin.on('data', () =>
            fixture.child.stderr.write('synthetic-secret'.repeat(8)),
        )
        fixture.child.stdin.on('finish', () => fixture.finish(1))
        await expect(start()).rejects.toMatchObject({ isUncertain: true })
        expect(JSON.stringify(failed.mock.calls)).not.toContain(
            'synthetic-secret',
        )
    })

    it('propagates a confirmed domain rejection and ignores raw stderr', async () => {
        receive = () => {
            fixture.child.stderr.write('synthetic-secret')
            fixture.send({
                type: 'error',
                requestId: requests.at(-1)?.requestId,
                error: {
                    code: 'RESTORE_JOURNAL_INVALID',
                    message: 'Ungültiger Journalnachweis.',
                },
            })
            fixture.finish(1)
        }
        await expect(start()).rejects.toMatchObject({
            code: 'RESTORE_JOURNAL_INVALID',
            isUncertain: false,
        })
        expect(JSON.stringify(failed.mock.calls)).not.toContain(
            'synthetic-secret',
        )
    })

    it.each([
        ['CORE_OPERATION_UNCERTAIN', true],
        ['CORE_PROTOCOL_ERROR', true],
        ['STORAGE_ROLLBACK_FAILED', true],
        ['ARCHIVE_CLEANUP_INCOMPLETE', false],
    ] as const)(
        'preserves native uncertainty for %s',
        async (code, isUncertain) => {
            receive = () => {
                fixture.send({
                    type: 'error',
                    requestId: requests.at(-1)?.requestId,
                    error: { code, message: 'Der Abschluss ist unbestätigt.' },
                })
                fixture.finish(1)
            }
            await expect(start()).rejects.toMatchObject({ code, isUncertain })
        },
    )

    it('requires a ready ACK and rejects an early clean exit', async () => {
        receive = () => fixture.finish()
        await expect(start()).rejects.toMatchObject({ isUncertain: true })
    })

    it('requires a successful exit after the close ACK', async () => {
        receive = (request) => {
            ack()
            if (request.operation === 'journalClose') fixture.finish(1)
        }
        const session = await start()
        await expect(
            session.close({ operation: 'journalClose' }, validate),
        ).rejects.toMatchObject({ isUncertain: true })
    })

    it('poisons the session after result validation fails and never sends queued mutations', async () => {
        const session = await start()
        const first = session.request({ operation: 'journalAppend' }, () => {
            throw new Error('synthetic invalid result')
        })
        const second = session.request({ operation: 'journalAppend' }, validate)
        expect(await Promise.allSettled([first, second])).toMatchObject([
            { status: 'rejected' },
            { status: 'rejected' },
        ])
        expect(requests).toHaveLength(2)
        await session.abort()
    })

    it('bounds its queue while allowing admitted requests to finish', async () => {
        const session = await start()
        receive = () => {
            setTimeout(ack, 5)
        }
        const admitted = Array.from({ length: 3 }, () =>
            session.request({ operation: 'journalAppend' }, validate),
        )
        await expect(
            session.request({ operation: 'journalAppend' }, validate),
        ).rejects.toMatchObject({ code: 'CORE_SESSION_BUSY' })
        await Promise.all(admitted)
        receive = normalResponse
        await session.close({ operation: 'journalClose' }, validate)
    })

    it('rejects oversized requests without poisoning a healthy session', async () => {
        const session = await start()
        await expect(
            session.request({ bytes: 'x'.repeat(300) }, validate),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        await session.close({ operation: 'journalClose' }, validate)
        await expect(session.request({}, validate)).rejects.toMatchObject({
            code: 'CORE_SESSION_CLOSED',
        })
        await session.abort()
    })

    it('checks cancellation and the initial request limit before spawning', async () => {
        await expect(
            start({ signal: AbortSignal.abort(new Error('synthetic abort')) }),
        ).rejects.toThrow('synthetic abort')
        await expect(
            open(
                'storage',
                [],
                { bytes: 'x'.repeat(300) },
                { validateReady: validate },
            ),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        expect(spawn).not.toHaveBeenCalled()
    })

    it('cancels an idle session and removes its private marker after exit', async () => {
        const controller = new AbortController()
        const session = await start({ signal: controller.signal })
        controller.abort()
        await session.abort()
        await expect(session.request({}, validate)).rejects.toMatchObject({
            code: 'CORE_CANCELLED',
            isUncertain: true,
        })
        await expect(
            stat(path.dirname(environment.MARKETPLACE_CORE_CANCEL_FILE!)),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('bounds a stuck response and forces termination if EOF is ignored', async () => {
        const session = await start({ timeoutMs: 5 })
        fixture.child.stdin.removeAllListeners('finish')
        receive = () => undefined
        await expect(
            session.request({ operation: 'journalAppend' }, validate),
        ).rejects.toMatchObject({
            code: 'CORE_OPERATION_UNCERTAIN',
            isUncertain: true,
        })
        expect(fixture.child.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('rejects spawn failure without retaining a temporary directory', async () => {
        spawn.mockImplementation((_binary, _args, options) => {
            environment = options.env
            throw new Error('synthetic spawn error')
        })
        await expect(start()).rejects.toMatchObject({
            code: 'CORE_UNAVAILABLE',
        })
        await expect(
            stat(path.dirname(environment.MARKETPLACE_CORE_CANCEL_FILE!)),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('handles asynchronous process and input-stream failure', async () => {
        receive = () => {
            fixture.child.emit('error', new Error('synthetic spawn error'))
            fixture.finish(1)
        }
        await expect(start()).rejects.toMatchObject({
            code: 'CORE_UNAVAILABLE',
        })
    })

    it('rejects broken input transport before trusting a response', async () => {
        receive = () => {
            fixture.child.stdin.emit('error', new Error('synthetic pipe error'))
        }
        await expect(start()).rejects.toMatchObject({
            code: 'CORE_TRANSPORT_ERROR',
            isUncertain: true,
        })
    })
})
