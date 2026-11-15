import type { BackupProcessor } from '@/tests/server/Admin/Backups/backup.worker.test.types.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { UnrecoverableError } from 'bullmq'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { startBackupWorker } from '@/server/Admin/Backups/backup.worker.ts'

const workerMocks = (function () {
    const workers: Array<{
        close: ReturnType<typeof vi.fn<() => Promise<void>>>
        hasRun: boolean
        isClosed: boolean
        listeners: Map<string, (...args: Array<never>) => void>
        options: Record<string, unknown>
        processor: BackupProcessor
        run: ReturnType<typeof vi.fn<() => Promise<void>>>
    }> = []
    const valkeyListeners = new Map<string, () => void>()
    let failClosedListenerRegistration = false

    return {
        backupQueue: {
            setGlobalConcurrency: vi.fn(async function () {}),
        },
        barrier: vi.fn(async function <TResult>(
            operation: () => Promise<TResult>,
        ) {
            return operation()
        }),
        getSettings: vi.fn(async function () {
            return { isEnabled: false }
        }),
        logError: vi.fn(function () {}),
        setFailClosedListenerRegistration: function (shouldFail: boolean) {
            failClosedListenerRegistration = shouldFail
        },
        shouldFailClosedListenerRegistration: function () {
            return failClosedListenerRegistration
        },
        parseJob: vi.fn(function (
            _name: string,
            data: Record<string, unknown>,
        ) {
            return data
        }),
        processJob: vi.fn(async function () {
            return 'processed'
        }),
        reconcileFailed: vi.fn(async function () {}),
        reconcileLost: vi.fn(async function () {}),
        valkey: {
            off: vi.fn(function (event: string) {
                valkeyListeners.delete(event)
            }),
            on: vi.fn(function (event: string, listener: () => void) {
                valkeyListeners.set(event, listener)
            }),
            ping: vi.fn(async function () {
                return 'PONG'
            }),
        },
        valkeyListeners,
        serializeSettings: vi.fn(function (settings: unknown) {
            return settings
        }),
        syncScheduler: vi.fn(async function () {}),
        workers,
    }
})()

vi.mock('bullmq', function () {
    return {
        UnrecoverableError: class BackupUnrecoverableTestError extends Error {
            override name = 'UnrecoverableError'
        },
        Worker: class {
            listeners = new Map<string, (...args: Array<never>) => void>()
            workerRecord: (typeof workerMocks.workers)[number]

            constructor(
                _name: string,
                processor: BackupProcessor,
                options: Record<string, unknown>,
            ) {
                this.workerRecord = {
                    close: vi.fn(async () => {
                        this.workerRecord.isClosed = true
                        this.listeners.get('closed')?.()
                    }),
                    hasRun: false,
                    isClosed: false,
                    listeners: this.listeners,
                    options,
                    processor,
                    run: vi.fn(async () => {
                        this.workerRecord.hasRun = true
                    }),
                }
                workerMocks.workers.push(this.workerRecord)
            }

            close() {
                return this.workerRecord.close()
            }

            isRunning() {
                return this.workerRecord.hasRun && !this.workerRecord.isClosed
            }

            on(event: string, listener: (...args: Array<never>) => void) {
                this.listeners.set(event, listener)
                return this
            }

            once(event: string, listener: (...args: Array<never>) => void) {
                if (
                    event === 'closed' &&
                    workerMocks.shouldFailClosedListenerRegistration()
                ) {
                    throw new Error('closed listener registration failed')
                }

                this.listeners.set(event, listener)
                return this
            }

            run() {
                return this.workerRecord.run()
            }
        },
    }
})

vi.mock('@/config/backup.config.ts', function () {
    return {
        BACKUP_QUEUE_NAME: 'backup',
        BACKUP_TIMEOUTS: { valkeyRecoveryGraceMs: 60_000 },
    }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getBullMqConnectionOptions: vi.fn(function () {
            return {}
        }),
        getValkeyConnection: vi.fn(function () {
            return workerMocks.valkey
        }),
    }
})

vi.mock('@/server/Admin/Backups/run-job.service.ts', function () {
    return {
        processBackupJob: workerMocks.processJob,
        reconcileFailedBackupJob: workerMocks.reconcileFailed,
    }
})

vi.mock('@/server/Admin/Backups/settings.service.ts', function () {
    return {
        getOrCreateBackupSettings: workerMocks.getSettings,
        serializeBackupSettings: workerMocks.serializeSettings,
    }
})

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    return {
        getBackupQueue: vi.fn(function () {
            return workerMocks.backupQueue
        }),
        parseBackupJobContract: workerMocks.parseJob,
        syncBackupScheduler: workerMocks.syncScheduler,
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return {
        logError: workerMocks.logError,
        logInfo: vi.fn(),
        logWarn: vi.fn(),
    }
})

vi.mock('@/server/Admin/Backups/backup-recovery.service.ts', function () {
    return { reconcileLostBackupQueueState: workerMocks.reconcileLost }
})

vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        RestoreInProgressError: class RestoreInProgressError extends Error {},
        withSharedStorageMutationBarrier: workerMocks.barrier,
    }
})

function createOptions() {
    return {
        isRestoreQuiescenceActive: vi.fn(async function () {
            return false
        }),
        runRestoreQuiesced: vi.fn(async function <TResult>(
            operation: (
                completeRestoreQuiescence: (
                    publishCompletedState: () => Promise<void>,
                ) => Promise<void>,
            ) => Promise<TResult>,
        ) {
            return operation(async function (publishCompletedState) {
                await publishCompletedState()
            })
        }),
    }
}

function getWorker() {
    const worker = workerMocks.workers.at(0)

    if (!worker) {
        throw new Error('Backup-Worker wurde nicht gestartet.')
    }

    return worker
}

describe('Backup-Worker-Restore-Barrieren', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        workerMocks.workers.length = 0
        workerMocks.valkeyListeners.clear()
        workerMocks.valkey.ping.mockReset()
        workerMocks.valkey.ping.mockResolvedValue('PONG')
        workerMocks.setFailClosedListenerRegistration(false)
    })

    it.each(['parse', 'scheduled-update', 'process', 'restore'])(
        'redigiert den %s-Fehler vor BullMQ ohne die interne Ursache zu verändern',
        async function (phase) {
            const cause = new Error('private SQL credential payload')
            const original = Object.assign(
                new Error(
                    'C:\\private\\synthetic-secret postgres://user:password@host/db',
                    { cause },
                ),
                { code: '23505' },
            )
            original.stack = 'SQL and synthetic-secret stack'
            const options = createOptions()
            await startBackupWorker(options)
            const job = {
                name:
                    phase === 'restore'
                        ? 'restore-backup'
                        : phase === 'scheduled-update'
                          ? 'scheduled-backup'
                          : 'manual-backup',
                data:
                    phase === 'restore'
                        ? {
                              contractVersion: 2,
                              kind: 'restore',
                              runId: '019f5b07-80e2-7000-8000-000000000001',
                              sourceBackupId:
                                  '019f5b07-80e2-7000-8000-000000000002',
                          }
                        : phase === 'scheduled-update'
                          ? { kind: 'create', trigger: 'scheduled' }
                          : {
                                kind: 'create',
                                runId: '019f5b07-80e2-7000-8000-000000000001',
                                trigger: 'manual',
                            },
                updateData: vi.fn(async function () {}),
                updateProgress: vi.fn(async function () {}),
            }
            if (phase === 'parse')
                workerMocks.parseJob.mockImplementationOnce(function () {
                    throw original
                })
            else if (phase === 'scheduled-update')
                job.updateData.mockRejectedValueOnce(original)
            else workerMocks.processJob.mockRejectedValueOnce(original)
            const error: unknown = await getWorker()
                .processor(job)
                .catch((caught: unknown) => caught)

            expect(error).toBeInstanceOf(Error)
            if (!(error instanceof Error))
                throw new Error('Expected processor Error')
            expect(error.message).toBe('Der Backup-Job ist fehlgeschlagen.')
            expect(error.stack).toBeUndefined()
            expect(error).not.toHaveProperty('cause')
            expect(error).toHaveProperty('code', '23505')
            expect(
                JSON.stringify(error, Object.getOwnPropertyNames(error)),
            ).not.toContain('synthetic-secret')
            expect(original.message).toContain('synthetic-secret')
            expect(original.cause).toBe(cause)
            expect(original.stack).toBe('SQL and synthetic-secret stack')
            expect(workerMocks.logError).toHaveBeenCalledWith(
                'backup.job.processor_failed',
                original,
                expect.objectContaining({ jobName: job.name }),
            )
            if (phase === 'parse' || phase === 'scheduled-update')
                expect(workerMocks.processJob).not.toHaveBeenCalled()
            if (phase === 'restore')
                expect(options.runRestoreQuiesced).toHaveBeenCalledTimes(1)
        },
    )

    it('behält einen nicht erneut ausführbaren BullMQ-Fehler ohne seinen Rohtext bei', async function () {
        await startBackupWorker(createOptions())
        workerMocks.processJob.mockRejectedValueOnce(
            new UnrecoverableError('private path and credentials'),
        )
        const error: unknown = await getWorker()
            .processor({
                name: 'manual-backup',
                data: {
                    kind: 'create',
                    runId: '019f5b07-80e2-7000-8000-000000000001',
                    trigger: 'manual',
                },
                updateData: vi.fn(async function () {}),
                updateProgress: vi.fn(async function () {}),
            })
            .catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(UnrecoverableError)
        if (!(error instanceof Error))
            throw new Error('Expected unrecoverable Error')
        expect(error.name).toBe('UnrecoverableError')
        expect(error.message).toBe('Der Backup-Job ist fehlgeschlagen.')
        expect(error.stack).toBeUndefined()
        expect(error).not.toHaveProperty('cause')
    })

    it.each(['failed', 'delayed'])(
        'führt die finale Reconciliation nur für den endgültigen Jobzustand aus: %s',
        async function (state) {
            await startBackupWorker(createOptions())
            const job = {
                id: '019f5b07-80e2-7000-8000-000000000001',
                name: 'manual-backup',
                data: {
                    kind: 'create',
                    runId: '019f5b07-80e2-7000-8000-000000000001',
                    trigger: 'manual',
                },
                getState: vi.fn(async function () {
                    return state
                }),
            }
            const failure = new Error('Der Backup-Job ist fehlgeschlagen.')
            getWorker().listeners.get('failed')?.(
                job as never,
                failure as never,
            )
            await waitForAssertion(function () {
                expect(job.getState).toHaveBeenCalledTimes(1)
            })
            if (state === 'failed') {
                await waitForAssertion(function () {
                    expect(workerMocks.reconcileFailed).toHaveBeenCalledWith(
                        job.data,
                        failure,
                    )
                })
            } else expect(workerMocks.reconcileFailed).not.toHaveBeenCalled()
        },
    )

    it('initialisiert Settings und Scheduler unter der gemeinsamen Barriere', async function () {
        const options = createOptions()

        await startBackupWorker(options)

        expect(workerMocks.barrier).toHaveBeenCalledTimes(1)
        expect(workerMocks.getSettings).toHaveBeenCalledTimes(1)
        expect(workerMocks.syncScheduler).toHaveBeenCalledTimes(1)
        expect(
            workerMocks.backupQueue.setGlobalConcurrency,
        ).toHaveBeenCalledWith(1)
        expect(workerMocks.workers).toHaveLength(1)
        expect(workerMocks.workers[0]?.options).toMatchObject({
            autorun: false,
        })
        expect(workerMocks.workers[0]?.run).toHaveBeenCalledTimes(1)
    })

    it('schließt einen nach fehlgeschlagenem Valkey-Ping konstruierten Worker vor einem erfolgreichen Retry', async function () {
        const pingError = new Error('valkey startup unavailable')
        workerMocks.valkey.ping.mockRejectedValueOnce(pingError)
        const options = createOptions()

        await expect(startBackupWorker(options)).rejects.toBe(pingError)

        expect(workerMocks.workers).toHaveLength(1)
        expect(workerMocks.workers[0]?.close).toHaveBeenCalledTimes(1)
        expect(workerMocks.workers[0]?.isClosed).toBe(true)
        expect(workerMocks.workers[0]?.run).not.toHaveBeenCalled()

        await expect(startBackupWorker(options)).resolves.toBeDefined()

        expect(workerMocks.workers).toHaveLength(2)
        expect(
            workerMocks.workers.filter((worker) => !worker.isClosed),
        ).toHaveLength(1)
        expect(workerMocks.workers[1]?.isClosed).toBe(false)
        expect(workerMocks.workers[1]?.run).toHaveBeenCalledTimes(1)
        expect(workerMocks.valkey.on).toHaveBeenCalledTimes(1)
    })

    it('entfernt einen bereits registrierten Valkey-Listener bei einem späteren Startupfehler', async function () {
        workerMocks.setFailClosedListenerRegistration(true)

        await expect(startBackupWorker(createOptions())).rejects.toThrow(
            'closed listener registration failed',
        )

        expect(workerMocks.valkey.on).toHaveBeenCalledTimes(1)
        expect(workerMocks.valkey.off).toHaveBeenCalledWith(
            'ready',
            expect.any(Function),
        )
        expect(workerMocks.valkeyListeners.has('ready')).toBe(false)
        expect(workerMocks.workers[0]?.close).toHaveBeenCalledTimes(1)
        expect(workerMocks.workers[0]?.isClosed).toBe(true)
        expect(workerMocks.workers[0]?.run).not.toHaveBeenCalled()
    })

    it('führt Restore-Jobs erst innerhalb des globalen Mail-Quiesce aus', async function () {
        const options = createOptions()
        await startBackupWorker(options)
        const job = {
            data: {
                contractVersion: 2,
                kind: 'restore',
                runId: '019f5b07-80e2-7000-8000-000000000001',
                sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
            },
            name: 'restore-backup',
            updateData: vi.fn(async function () {}),
            updateProgress: vi.fn(async function () {}),
        }

        await expect(getWorker().processor(job)).resolves.toBe('processed')

        expect(options.runRestoreQuiesced).toHaveBeenCalledTimes(1)
        expect(workerMocks.processJob).toHaveBeenCalledWith(
            job.data,
            expect.objectContaining({
                completeRestoreQuiescence: expect.any(Function),
                reportProgress: expect.any(Function),
            }),
        )
    })

    it('wartet beim Shutdown auf den gesamten Restore-Processor und startet keine neue Reconnect-Recovery', async function () {
        const restoreFinished = Promise.withResolvers<string>()
        workerMocks.processJob.mockReturnValueOnce(restoreFinished.promise)
        const runtime = await startBackupWorker(createOptions())
        const rawWorker = getWorker()
        const processing = rawWorker.processor({
            name: 'restore-backup',
            data: {
                contractVersion: 2,
                kind: 'restore',
                runId: '019f5b07-80e2-7000-8000-000000000001',
                sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
            },
            updateData: vi.fn(async function () {}),
            updateProgress: vi.fn(async function () {}),
        })
        await waitForAssertion(() =>
            expect(workerMocks.processJob).toHaveBeenCalledTimes(1),
        )
        const completed = vi.fn()
        const stopped = runtime.close()
        void stopped.then(completed)
        await waitForAssertion(() =>
            expect(rawWorker.close).toHaveBeenCalledTimes(1),
        )
        expect(completed).not.toHaveBeenCalled()
        expect(workerMocks.valkeyListeners.has('ready')).toBe(false)
        restoreFinished.resolve('restore-completed')
        await expect(processing).resolves.toBe('restore-completed')
        await stopped
        expect(workerMocks.reconcileLost).not.toHaveBeenCalled()
        expect(runtime.isRunning()).toBe(false)
    })

    it('hält auch normale Backup-Jobs unter der gemeinsamen Barriere', async function () {
        const options = createOptions()
        await startBackupWorker(options)
        const job = {
            data: {
                kind: 'create',
                runId: '019f5b07-80e2-7000-8000-000000000001',
                trigger: 'manual',
            },
            name: 'manual-backup',
            updateData: vi.fn(async function () {}),
            updateProgress: vi.fn(async function () {}),
        }

        await getWorker().processor(job)

        expect(options.runRestoreQuiesced).not.toHaveBeenCalled()
        expect(workerMocks.barrier).toHaveBeenCalledTimes(2)
        expect(workerMocks.processJob).toHaveBeenCalledTimes(1)
    })

    it('startet bei bereits aktivem Quiesce keinen Backup-Worker', async function () {
        const options = createOptions()
        options.isRestoreQuiescenceActive.mockResolvedValue(true)

        await expect(startBackupWorker(options)).rejects.toThrow()

        expect(workerMocks.getSettings).not.toHaveBeenCalled()
        expect(workerMocks.workers).toHaveLength(0)
    })

    it('überspringt Reconnect-Reconciliation während des Restore ohne zu blockieren', async function () {
        const options = createOptions()
        await startBackupWorker(options)
        options.isRestoreQuiescenceActive.mockResolvedValue(true)

        workerMocks.valkeyListeners.get('ready')?.()
        await waitForAssertion(function () {
            expect(options.isRestoreQuiescenceActive).toHaveBeenCalledTimes(2)
        })

        expect(workerMocks.getSettings).toHaveBeenCalledTimes(1)
        expect(workerMocks.reconcileLost).not.toHaveBeenCalled()
    })

    it('unterdrückt finale DB-Reconciliation unter aktivem Recovery-Marker', async function () {
        const options = createOptions()
        await startBackupWorker(options)
        options.isRestoreQuiescenceActive.mockResolvedValue(true)
        const failedListener = getWorker().listeners.get('failed')
        const job = {
            data: {
                contractVersion: 2,
                kind: 'restore',
                runId: '019f5b07-80e2-7000-8000-000000000001',
                sourceBackupId: '019f5b07-80e2-7000-8000-000000000002',
            },
            getState: vi.fn(async function () {
                return 'failed'
            }),
            id: 'job-1',
            name: 'restore-backup',
        }

        failedListener?.(job as never, new Error('recovery-required') as never)
        await waitForAssertion(function () {
            expect(job.getState).toHaveBeenCalledTimes(1)
        })

        expect(workerMocks.reconcileFailed).not.toHaveBeenCalled()
    })
})
