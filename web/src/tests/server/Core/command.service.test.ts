import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { readFile, stat } from 'node:fs/promises'
import * as filesystem from 'node:fs/promises'
import { createCoreProcessFixture } from './command.test.helpers.ts'
import { CoreCommandError } from '@/server/Core/error.ts'

const binary = vi.fn(async () => '/synthetic/core')
const started = vi.fn()
const failed = vi.fn()
const spawn = vi.fn()
const actualCoreRuntime = {
    ...(await import('@/config/core.config.ts')).CORE_RUNTIME,
}
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('@/server/Core/binary.service.ts', () => ({
    getCoreBinaryPathService: binary,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo: started,
    logError: failed,
}))
vi.mock('@/config/core.config.ts', () => ({
    CORE_RUNTIME: {
        ...actualCoreRuntime,
        maxRequestBytes: 256,
        maxOutputBytes: 1024,
        maxRecordBytes: 256,
        maxErrorBytes: 64,
        cancellationGraceMs: 25,
        commandTimeoutMs: 1000,
    },
}))
const { runOneShotCoreCommandService: run } =
    await import('@/server/Core/one-shot.service.ts')
let processFixture: ReturnType<typeof createCoreProcessFixture>
let environment: NodeJS.ProcessEnv
beforeEach(() => {
    vi.clearAllMocks()
    binary.mockResolvedValue('/synthetic/core')
    processFixture = createCoreProcessFixture()
    spawn.mockImplementation((_path, _arguments, options) => {
        environment = options.env
        return processFixture.child
    })
})
afterEach(() => {
    processFixture.finish()
})

describe('Rust-Prozessgrenze', () => {
    it.each([
        ['CORE_OPERATION_UNCERTAIN', true],
        ['STORAGE_ROLLBACK_FAILED', true],
        ['CORE_PROTOCOL_ERROR', false],
        ['ARCHIVE_CLEANUP_INCOMPLETE', false],
        ['ARCHIVE_INVALID', false],
    ] as const)(
        'erhält die Unsicherheitsklassifikation nativer Einzelaufrufe für %s',
        async (code, isUncertain) => {
            processFixture.child.stdin.on('finish', () => {
                processFixture.send({
                    type: 'error',
                    error: { code, message: 'Nativer Fehler.' },
                })
                processFixture.finish(1)
            })
            await expect(run('archive', {})).rejects.toMatchObject({
                code,
                isUncertain,
            })
        },
    )

    it.each([
        ['storage', 'prepareDirectories'],
        ['storage', 'assertDirectories'],
        ['storage', 'readBackground'],
        ['archive', 'admissionReserve'],
    ] as const)(
        'hält erfolgreiche Routineaufrufe ohne Konsolenausgabe (%s/%s)',
        async (binaryName, operation) => {
            processFixture.child.stdin.on('finish', () => {
                processFixture.send({ type: 'result', result: null })
                processFixture.finish()
            })
            await expect(run(binaryName, { operation })).resolves.toBeNull()
            expect(started).not.toHaveBeenCalled()
            expect(failed).not.toHaveBeenCalled()
        },
    )

    it('meldet fehlgeschlagene Routineprüfungen weiterhin als Fehler', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({
                type: 'error',
                error: { code: 'EACCES', message: 'Zugriff verweigert.' },
            })
            processFixture.finish(1)
        })
        await expect(
            run('storage', { operation: 'assertDirectories' }),
        ).rejects.toMatchObject({ code: 'EACCES' })
        expect(started).not.toHaveBeenCalled()
        expect(failed).toHaveBeenCalledTimes(1)
        expect(failed.mock.calls[0]?.[0]).toBe('core.storage_failed')
    })

    it.each([
        ['archive', 'create'],
        ['storage', 'recoveryPrepare'],
        ['storage', 'postgresDump'],
    ] as const)(
        'behält Start und Abschluss wichtiger Aufträge im Core-Verlauf (%s/%s)',
        async (binaryName, operation) => {
            processFixture.child.stdin.on('finish', () => {
                processFixture.send({ type: 'result', result: null })
                processFixture.finish()
            })
            await run(binaryName, { operation })
            expect(started.mock.calls.map((call) => call[0])).toEqual([
                `core.${binaryName}_started`,
                `core.${binaryName}_completed`,
            ])
        },
    )

    it('liest den nativen Abbruch auch bei einem dauerhaft blockierten Fortschrittscallback', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({ type: 'progress', progress: 1 })
            setTimeout(() => {
                processFixture.send({
                    type: 'error',
                    error: { code: 'CORE_CANCELLED', message: 'Abgebrochen.' },
                })
                processFixture.finish(1)
            }, 15)
        })
        await expect(
            run(
                'storage',
                {},
                { timeoutMs: 5, onProgress: () => new Promise<void>(() => {}) },
            ),
        ).rejects.toMatchObject({ code: 'CORE_TIMEOUT', isUncertain: false })
        expect(processFixture.child.kill).not.toHaveBeenCalled()
    })

    it('bestätigt das Ergebnis trotz hängendem Fortschrittscallback nach Prozessende', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({ type: 'progress', progress: 1 })
            setTimeout(() => {
                processFixture.send({
                    type: 'result',
                    result: { recovery: 'confirmed' },
                })
                processFixture.finish()
            }, 5)
        })
        expect(
            await run(
                'storage',
                {},
                { onProgress: () => new Promise<void>(() => {}) },
            ),
        ).toEqual({ recovery: 'confirmed' })
    })

    it.each(['{"type":"result","result":2}\n', 'invalid\n', 'x'.repeat(300)])(
        'verwirft beschädigte Antworten auch nach einem früheren Abbruch (%s)',
        async (invalid) => {
            const controller = new AbortController()
            processFixture.child.stdin.on('finish', () => {
                controller.abort(new Error('late abort'))
                processFixture.send({
                    type: 'result',
                    result: { recovery: 'unconfirmed' },
                })
                processFixture.child.stdout.write(invalid)
                processFixture.finish()
            })
            await expect(
                run('storage', {}, { signal: controller.signal }),
            ).rejects.toMatchObject({
                code: 'CORE_PROTOCOL_ERROR',
                isUncertain: true,
            })
        },
    )

    it('erhält ein bestätigtes Recovery-Ergebnis auch bei einem fehlgeschlagenen späten Abbruchmarker', async () => {
        const writer = vi
            .spyOn(filesystem, 'writeFile')
            .mockRejectedValueOnce(new Error('synthetic ENOSPC'))
        const controller = new AbortController()
        try {
            processFixture.child.stdin.on('finish', () => {
                controller.abort(new Error('late abort'))
                processFixture.send({
                    type: 'result',
                    result: { recovery: 'committed' },
                })
                processFixture.finish()
            })
            expect(
                await run('storage', {}, { signal: controller.signal }),
            ).toEqual({ recovery: 'committed' })
        } finally {
            writer.mockRestore()
        }
    })
    it('überträgt explizite Daten und Fortschritt, prüft Ergebnisse und entfernt den Abbruchmarker', async () => {
        let input = ''
        processFixture.child.stdin.on('data', (data) => {
            input += data
        })
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({ type: 'progress', progress: { bytes: 5 } })
            processFixture.send({ type: 'result', result: { files: 2 } })
            processFixture.finish()
        })
        const progress = vi.fn()
        const result = await run(
            'storage',
            { operation: 'test' },
            {
                environment: { EXPLICIT_SETTING: 'synthetic' },
                onProgress: progress,
                validateResult(value) {
                    if (
                        !value ||
                        typeof value !== 'object' ||
                        !('files' in value)
                    )
                        throw new Error()
                    return value.files
                },
            },
        )
        expect(result).toBe(2)
        expect(input).toBe('{"operation":"test"}')
        expect(progress).toHaveBeenCalledWith({ bytes: 5 })
        expect(environment.EXPLICIT_SETTING).toBe('synthetic')
        expect(environment.DATABASE_URL).toBeUndefined()
        expect(environment.SMTP_PASSWORD).toBeUndefined()
        expect(spawn.mock.calls[0]?.[1]).toEqual([])
        expect(spawn.mock.calls[0]?.[2].windowsHide).toBe(true)
        await expect(
            stat(environment.MARKETPLACE_CORE_CANCEL_FILE!),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(started.mock.calls.map((call) => call[0])).toEqual([
            'core.storage_started',
            'core.storage_completed',
        ])
    })

    it('verwirft einen früheren Abbruch und zu große Anfragen vor dem Prozessstart', async () => {
        await expect(
            run(
                'archive',
                {},
                { signal: AbortSignal.abort(new Error('stopped')) },
            ),
        ).rejects.toThrow('stopped')
        await expect(
            run('archive', { data: 'x'.repeat(300) }),
        ).rejects.toMatchObject({ code: 'CORE_REQUEST_TOO_LARGE' })
        expect(spawn).not.toHaveBeenCalled()
    })

    it.each([
        ['', 0],
        ['not-json\n', 0],
        ['{"type":"result","result":1}\n{"type":"result","result":2}\n', 0],
        ['{"type":"progress","progress":1,"unexpected":true}\n', 0],
        ['{"type":"result","result":1}\n', 1],
        ['x'.repeat(300), 0],
    ])(
        'hält einen unbestätigten oder beschädigten Abschluss sicher gesperrt (%s)',
        async (output, code) => {
            processFixture.child.stdin.on('finish', () => {
                processFixture.child.stdout.write(output)
                processFixture.finish(code)
            })
            await expect(run('storage', {})).rejects.toMatchObject({
                isUncertain: true,
            })
            expect(failed).toHaveBeenCalled()
        },
    )

    it('gibt einen bestätigten Fachfehler weiter, ohne native Diagnosen zu protokollieren', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.child.stderr.write('synthetic-secret')
            processFixture.send({
                type: 'error',
                error: {
                    code: 'ARCHIVE_INVALID',
                    message: 'Ungültiges Archiv.',
                },
            })
            processFixture.finish(1)
        })
        await expect(run('archive', {})).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
            isUncertain: false,
        })
        expect(JSON.stringify(failed.mock.calls)).not.toContain(
            'synthetic-secret',
        )
    })

    it('behält das Recovery-Ergebnis, wenn nach dem Commit ein Abbruch eintrifft', async () => {
        const controller = new AbortController()
        processFixture.child.stdin.on('finish', () => {
            controller.abort(new Error('late abort'))
            processFixture.send({
                type: 'result',
                result: { recovery: 'owned-handle' },
            })
            processFixture.finish()
        })
        expect(await run('storage', {}, { signal: controller.signal })).toEqual(
            { recovery: 'owned-handle' },
        )
    })

    it('gibt einen unbestätigten Rollback trotz ursprünglichem Abbruch als unsicher zurück', async () => {
        const controller = new AbortController()
        processFixture.child.stdin.on('finish', () => {
            controller.abort(new Error('initial abort'))
            processFixture.send({
                type: 'error',
                error: {
                    code: 'STORAGE_ROLLBACK_FAILED',
                    message: 'Rollback unbestätigt.',
                },
            })
            processFixture.finish(1)
        })
        await expect(
            run('storage', {}, { signal: controller.signal }),
        ).rejects.toMatchObject({
            code: 'STORAGE_ROLLBACK_FAILED',
            isUncertain: true,
        })
    })

    it('wartet nach einem Fortschrittsfehler auf den bestätigten nativen Abbruch', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({ type: 'progress', progress: 1 })
            setTimeout(() => {
                processFixture.send({
                    type: 'error',
                    error: { code: 'CORE_CANCELLED', message: 'Abgebrochen.' },
                })
                processFixture.finish(1)
            }, 10)
        })
        await expect(
            run(
                'archive',
                {},
                {
                    onProgress: () => {
                        throw new Error('progress failed')
                    },
                },
            ),
        ).rejects.toThrow('progress failed')
        expect(processFixture.child.kill).not.toHaveBeenCalled()
    })

    it('setzt für einen hängenden Auftrag einen privaten Abbruchmarker und erzwingt anschließend das Ende', async () => {
        let marker = ''
        processFixture.child.stdin.on('finish', () => {
            setTimeout(async () => {
                marker = await readFile(
                    environment.MARKETPLACE_CORE_CANCEL_FILE!,
                    'utf8',
                )
            }, 15)
        })
        await expect(
            run('storage', {}, { timeoutMs: 5 }),
        ).rejects.toMatchObject({
            code: 'CORE_OPERATION_UNCERTAIN',
            isUncertain: true,
        })
        expect(marker).toBe('')
        expect(processFixture.child.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('weist Diagnosen über dem Größenlimit und ungültige Resultate als unbestätigt zurück', async () => {
        processFixture.child.stdin.on('finish', () => {
            processFixture.child.stderr.write('x'.repeat(65))
            processFixture.finish()
        })
        await expect(run('storage', {})).rejects.toMatchObject({
            isUncertain: true,
        })
        processFixture = createCoreProcessFixture()
        processFixture.child.stdin.on('finish', () => {
            processFixture.send({ type: 'result', result: null })
            processFixture.finish()
        })
        await expect(
            run(
                'storage',
                {},
                {
                    validateResult() {
                        throw new Error('wrong type')
                    },
                },
            ),
        ).rejects.toBeInstanceOf(CoreCommandError)
    })
})
