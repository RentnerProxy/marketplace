import type { QueueState } from '@/tests/server/Queues/mail-restore-quiescence.service.test.types.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { createMailRestoreQuiescenceService } from '@/server/Queues/mail-restore-quiescence.service.ts'
import { MAIL_QUEUE_NAME } from '@/server/Queues/mail.queue.ts'
import { startMailWorker } from '@/server/Queues/mail.worker.ts'

const quiescenceMocks = (function () {
    const queues = new Map<string, QueueState>()
    const order: Array<string> = []
    const valkeyListeners = new Map<string, () => void>()
    let restoreState: Record<string, unknown> | Error | null = null
    let storedQuiescence: string | null = null
    let tryLockAcquired = true

    function getQueueState(name: string) {
        const existing = queues.get(name)

        if (existing) {
            return existing
        }

        const state: QueueState = {
            activeCounts: [0],
            close: vi.fn(async function () {}),
            delayedIds: [],
            isPaused: false,
            pause: vi.fn(async function () {
                order.push(`pause:${name}`)
                state.isPaused = true
                state.pausedIds.push(...state.waitIds)
                state.waitIds.length = 0
            }),
            pausedIds: [],
            prioritizedIds: [],
            remove: vi.fn(async function (jobId: string) {
                order.push(`remove:${name}:${jobId}`)
                state.waitIds = state.waitIds.filter((id) => id !== jobId)
                state.pausedIds = state.pausedIds.filter((id) => id !== jobId)
                state.delayedIds = state.delayedIds.filter((id) => id !== jobId)
                state.prioritizedIds = state.prioritizedIds.filter(
                    (id) => id !== jobId,
                )
                return 1
            }),
            resume: vi.fn(async function () {
                order.push(`resume:${name}`)
                state.isPaused = false
                state.waitIds.push(...state.pausedIds)
                state.pausedIds.length = 0
            }),
            waitIds: [],
            waitingChildrenIds: [],
        }
        queues.set(name, state)
        return state
    }

    return {
        getQueueState,
        getRestoreState: vi.fn(async function () {
            if (restoreState instanceof Error) {
                throw restoreState
            }

            return restoreState
        }),
        getStoredQuiescence: function () {
            return storedQuiescence
        },
        order,
        queues,
        queueConstructor: vi.fn(function (_name: string) {}),
        workerConstructor: vi.fn(function (_name: string) {}),
        valkey: {
            eval: vi.fn(async function (
                script: string,
                keyCount: number,
                ...arguments_: string[]
            ) {
                const expected = arguments_[keyCount]
                const replacement = arguments_[keyCount + 1]
                if (storedQuiescence !== expected) {
                    return script.includes('LLEN') ? -1 : 0
                }

                if (script.includes('LLEN')) {
                    for (const [name, queue] of queues) {
                        if (
                            !arguments_
                                .slice(1, keyCount)
                                .includes(`bull:${name}:active`)
                        )
                            continue
                        if (
                            (queue.activeCounts[0] ?? 0) > 0 ||
                            queue.waitIds.length > 0 ||
                            queue.pausedIds.length > 0 ||
                            queue.delayedIds.length > 0 ||
                            queue.prioritizedIds.length > 0 ||
                            queue.waitingChildrenIds.length > 0
                        )
                            return 0
                    }
                }

                if (script.includes("server.call('set'")) {
                    storedQuiescence = replacement ?? null
                } else {
                    storedQuiescence = null
                }

                return 1
            }),
            get: vi.fn(async function () {
                return storedQuiescence
            }),
            off: vi.fn(function (event: string) {
                valkeyListeners.delete(event)
            }),
            on: vi.fn(function (event: string, listener: () => void) {
                valkeyListeners.set(event, listener)
            }),
            set: vi.fn(async function (
                _key: string,
                value: string,
                mode: string,
            ) {
                if (mode !== 'NX' || storedQuiescence !== null) {
                    return null
                }

                storedQuiescence = value
                return 'OK'
            }),
        },
        reset: function () {
            queues.clear()
            order.length = 0
            valkeyListeners.clear()
            restoreState = null
            storedQuiescence = null
            tryLockAcquired = true
        },
        setRestoreState: function (
            state: Record<string, unknown> | Error | null,
        ) {
            restoreState = state
        },
        setStoredQuiescence: function (serialized: string | null) {
            storedQuiescence = serialized
        },
        setTryLockAcquired: function (acquired: boolean) {
            tryLockAcquired = acquired
        },
        tryExclusiveBarrier: vi.fn(async function <TResult>(
            operation: () => Promise<TResult>,
        ) {
            if (!tryLockAcquired) {
                return { acquired: false as const }
            }

            return {
                acquired: true as const,
                result: await operation(),
            }
        }),
        writeRestoreState: vi.fn(async function (
            state: Record<string, unknown>,
        ) {
            restoreState = { version: 1, ...state }
            return restoreState
        }),
        valkeyListeners,
    }
})()

function RejectUnexpectedWorker(name: string) {
    quiescenceMocks.workerConstructor(name)
    throw new Error(
        'Consumer must not start with an incompatible quiescence record',
    )
}

vi.mock('bullmq', function () {
    return {
        Worker: RejectUnexpectedWorker,
        Queue: class {
            name: string

            constructor(name: string) {
                this.name = name
                quiescenceMocks.queueConstructor(name)
                quiescenceMocks.getQueueState(name)
            }

            close() {
                const close = quiescenceMocks.getQueueState(this.name)
                    .close as unknown as () => Promise<void>
                return close()
            }

            getBackend() {
                return {
                    client: Promise.resolve({
                        lrange: async (
                            _key: string,
                            _start: number,
                            _end: number,
                        ) => {
                            const state = quiescenceMocks.getQueueState(
                                this.name,
                            )
                            return _key.endsWith(':paused')
                                ? [...state.pausedIds]
                                : [...state.waitIds]
                        },
                    }),
                }
            }

            async getJobCounts() {
                const state = quiescenceMocks.getQueueState(this.name)
                const active = state.activeCounts.shift() ?? 0
                return { active }
            }

            async getJobs() {
                const state = quiescenceMocks.getQueueState(this.name)
                return [...state.delayedIds, ...state.prioritizedIds].map(
                    (id) => ({ id }),
                )
            }

            isPaused() {
                return Promise.resolve(
                    quiescenceMocks.getQueueState(this.name).isPaused,
                )
            }

            pause() {
                const pause = quiescenceMocks.getQueueState(this.name)
                    .pause as unknown as () => Promise<void>
                return pause()
            }

            remove(jobId: string) {
                const remove = quiescenceMocks.getQueueState(this.name)
                    .remove as unknown as (id: string) => Promise<number>
                return remove(jobId)
            }

            resume() {
                const resume = quiescenceMocks.getQueueState(this.name)
                    .resume as unknown as () => Promise<void>
                return resume()
            }

            toKey(type: string) {
                return `bull:${this.name}:${type}`
            }
        },
    }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getBullMqProducerConnectionOptions: vi.fn(function () {
            return {}
        }),
        getBullMqConnectionOptions: vi.fn(function () {
            return {}
        }),
        getValkeyConnection: vi.fn(function () {
            return quiescenceMocks.valkey
        }),
    }
})

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return {
        getRestoreStateService: quiescenceMocks.getRestoreState,
        writeRestoreStateService: quiescenceMocks.writeRestoreState,
    }
})

vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        tryWithExclusiveStorageMutationBarrier:
            quiescenceMocks.tryExclusiveBarrier,
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn(function () {}), logInfo: vi.fn(function () {}) }
})

vi.mock('@/lib/Mail/mail.ts', function () {
    return {
        sendPasswordResetMail: vi.fn(async function () {}),
        sendPasswordSetupMail: vi.fn(async function () {}),
        sendFailedLoginAlertMail: vi.fn(async function () {}),
    }
})

function getRestoreState(
    status: 'running' | 'completed' | 'failed' | 'recovery-required',
    startedAt = '2026-08-11T08:00:00.000Z',
) {
    return {
        version: 1,
        status,
        phase: status === 'completed' ? 'finalizing' : 'preparing',
        percent: status === 'completed' ? 100 : null,
        processedBytes: 0,
        totalBytes: 0,
        startedAt,
        updatedAt:
            status === 'completed' ? '2026-08-11T08:01:00.000Z' : startedAt,
    }
}

function createService(
    options: { timeoutMs?: number; queueNames?: ReadonlyArray<string> } = {},
) {
    return createMailRestoreQuiescenceService({
        queueNames: options.queueNames ?? ['mail-v2', 'mail'],
        activeDrainPollIntervalMs: 1,
        activeDrainTimeoutMs: options.timeoutMs ?? 100,
        ownerLeaseMs: 100,
    })
}

function setStoredRunningQuiescence(ownerLeaseUntil = 0) {
    const running = getRestoreState('running')
    quiescenceMocks.setRestoreState(running)
    quiescenceMocks.setStoredQuiescence(
        JSON.stringify({
            version: 1,
            token: '019f5b07-80e2-7000-8000-000000000001',
            phase: 'paused',
            ownerLeaseUntil,
            restoreBaseline: {
                kind: 'known',
                state: {
                    startedAt: running.startedAt,
                    status: running.status,
                    updatedAt: running.updatedAt,
                },
            },
            queues: [
                {
                    name: 'mail-v2',
                    pendingJobIds: [],
                    wasPaused: false,
                },
                {
                    name: 'mail',
                    pendingJobIds: [],
                    wasPaused: false,
                },
            ],
        }),
    )
}

function setStoredTwoQueueQuiescence(
    phase: 'pausing' | 'paused' | 'purged' = 'paused',
) {
    const serialized = JSON.stringify({
        version: 1,
        token: '019f5b07-80e2-7000-8000-000000000001',
        phase,
        ownerLeaseUntil: 0,
        restoreBaseline: { kind: 'known', state: null },
        queues: [
            {
                name: 'mail',
                pendingJobIds: ['old-plaintext-mail'],
                wasPaused: false,
            },
            {
                name: MAIL_QUEUE_NAME,
                pendingJobIds: ['old-v2-mail', 'delayed-v2', 'prioritized-v2'],
                wasPaused: false,
            },
        ],
    })
    quiescenceMocks.setStoredQuiescence(serialized)
    const oldQueue = quiescenceMocks.getQueueState('mail')
    oldQueue.isPaused = true
    oldQueue.pausedIds = ['old-plaintext-mail']
    const currentQueue = quiescenceMocks.getQueueState(MAIL_QUEUE_NAME)
    currentQueue.waitIds = ['old-v2-mail']
    currentQueue.delayedIds = ['delayed-v2']
    currentQueue.prioritizedIds = ['prioritized-v2']
    return serialized
}

function expectOldQueueContractPreserved(serialized: string) {
    const oldQueue = quiescenceMocks.getQueueState('mail')
    const currentQueue = quiescenceMocks.getQueueState(MAIL_QUEUE_NAME)
    expect(quiescenceMocks.getStoredQuiescence()).toBe(serialized)
    expect(quiescenceMocks.valkey.set).not.toHaveBeenCalled()
    expect(quiescenceMocks.valkey.eval).not.toHaveBeenCalled()
    expect(quiescenceMocks.writeRestoreState).not.toHaveBeenCalled()
    expect(currentQueue.isPaused).toBe(true)
    expect(currentQueue.pause).toHaveBeenCalled()
    expect(currentQueue.remove).not.toHaveBeenCalled()
    expect(currentQueue.resume).not.toHaveBeenCalled()
    expect(
        [
            ...currentQueue.waitIds,
            ...currentQueue.pausedIds,
            ...currentQueue.delayedIds,
            ...currentQueue.prioritizedIds,
        ].toSorted(),
    ).toEqual(['old-v2-mail', 'delayed-v2', 'prioritized-v2'].toSorted())
    expect(oldQueue.isPaused).toBe(true)
    expect(oldQueue.pausedIds).toEqual(['old-plaintext-mail'])
    expect(oldQueue.pause).not.toHaveBeenCalled()
    expect(oldQueue.remove).not.toHaveBeenCalled()
    expect(oldQueue.resume).not.toHaveBeenCalled()
    expect(
        quiescenceMocks.queueConstructor.mock.calls.map(([name]) => name),
    ).toEqual([MAIL_QUEUE_NAME])
}

function setUnknownEmptyQuiescence() {
    const record = {
        version: 1,
        token: '019f5b07-80e2-7000-8000-000000000001',
        phase: 'paused',
        ownerLeaseUntil: 0,
        restoreBaseline: { kind: 'unknown' },
        queues: [
            { name: MAIL_QUEUE_NAME, pendingJobIds: [], wasPaused: false },
        ],
    }
    quiescenceMocks.setStoredQuiescence(JSON.stringify(record))
    quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).isPaused = true
    return record
}

describe('Globaler Mail-Quiesce für Restore', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        quiescenceMocks.reset()
    })

    it('gibt einen abgelaufenen unbekannten Pausenzustand nur für eine leere Queue ohne Restore unter exklusiver Sperre frei', async function () {
        setUnknownEmptyQuiescence()
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        try {
            await service.reconcileStartup()
            const queue = quiescenceMocks.getQueueState(MAIL_QUEUE_NAME)
            expect(quiescenceMocks.tryExclusiveBarrier).toHaveBeenCalledTimes(1)
            expect(queue.isPaused).toBe(false)
            expect(queue.resume).toHaveBeenCalledTimes(1)
            expect(queue.remove).not.toHaveBeenCalled()
            expect(quiescenceMocks.writeRestoreState).not.toHaveBeenCalled()
            expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        } finally {
            await service.close()
        }
    })

    it.each([
        'active',
        'waitIds',
        'pausedIds',
        'delayedIds',
        'prioritizedIds',
        'waitingChildrenIds',
    ] as const)(
        'behält die unbekannte Pause bei Jobs in %s bei',
        async function (state) {
            const record = setUnknownEmptyQuiescence()
            const queue = quiescenceMocks.getQueueState(MAIL_QUEUE_NAME)
            if (state === 'active') queue.activeCounts = [0, 1]
            else queue[state] = ['existing-job']
            const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
            try {
                await expect(service.reconcileStartup()).rejects.toThrow(
                    'unbekannten Restore-Zustand',
                )
                expect(queue.isPaused).toBe(true)
                expect(queue.resume).not.toHaveBeenCalled()
                expect(queue.remove).not.toHaveBeenCalled()
                expect(quiescenceMocks.getStoredQuiescence()).toBe(
                    JSON.stringify(record),
                )
            } finally {
                await service.close()
            }
        },
    )

    it('gibt keine unbekannte Pause mit gespeicherten alten Jobs frei', async function () {
        const record = setUnknownEmptyQuiescence()
        quiescenceMocks.setStoredQuiescence(
            JSON.stringify({
                ...record,
                queues: [{ ...record.queues[0], pendingJobIds: ['old-job'] }],
            }),
        )
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        try {
            await expect(service.reconcileStartup()).rejects.toThrow(
                'unbekannten Restore-Zustand',
            )
            expect(quiescenceMocks.tryExclusiveBarrier).not.toHaveBeenCalled()
            expect(
                quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).resume,
            ).not.toHaveBeenCalled()
        } finally {
            await service.close()
        }
    })

    it('behält die unbekannte Pause bei belegter exklusiver Sperre bei', async function () {
        const record = setUnknownEmptyQuiescence()
        quiescenceMocks.setTryLockAcquired(false)
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        try {
            await expect(service.reconcileStartup()).rejects.toThrow(
                'unbekannten Restore-Zustand',
            )
            expect(quiescenceMocks.getStoredQuiescence()).toBe(
                JSON.stringify(record),
            )
            expect(
                quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).resume,
            ).not.toHaveBeenCalled()
        } finally {
            await service.close()
        }
    })

    it.each([
        'running',
        'completed',
        'failed',
        'recovery-required',
        'unknown',
    ] as const)(
        'gibt die unbekannte Pause bei erneut beobachtetem Restore-Zustand %s nicht frei',
        async function (status) {
            setUnknownEmptyQuiescence()
            quiescenceMocks.getRestoreState.mockResolvedValueOnce(null)
            if (status === 'unknown') {
                quiescenceMocks.getRestoreState.mockRejectedValueOnce(
                    new Error('unlesbar'),
                )
            } else {
                quiescenceMocks.getRestoreState.mockResolvedValueOnce(
                    getRestoreState(status),
                )
            }
            const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
            try {
                await expect(service.reconcileStartup()).rejects.toThrow(
                    'unbekannten Restore-Zustand',
                )
                expect(
                    quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).resume,
                ).not.toHaveBeenCalled()
                expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
            } finally {
                await service.close()
            }
        },
    )

    it('prüft einen parallel erneuerten Pausenmarker vor der Freigabe per CAS', async function () {
        setUnknownEmptyQuiescence()
        quiescenceMocks.valkey.eval.mockResolvedValueOnce(-1)
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        try {
            await expect(service.reconcileStartup()).rejects.toThrow(
                'parallel verändert',
            )
            expect(
                quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).resume,
            ).not.toHaveBeenCalled()
            expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        } finally {
            await service.close()
        }
    })

    it('führt den aktuellen Restorevertrag nur für die echte v2-Queue unter unverändertem v1-Valkey-Key aus', async function () {
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        const queue = quiescenceMocks.getQueueState(MAIL_QUEUE_NAME)
        queue.waitIds = ['existing-v2-job']
        const operation = vi.fn(async function (completeRestoreQuiescence) {
            const stored: unknown = JSON.parse(
                quiescenceMocks.getStoredQuiescence() ?? 'null',
            )
            expect(stored).toMatchObject({
                version: 1,
                queues: [
                    {
                        name: MAIL_QUEUE_NAME,
                        pendingJobIds: ['existing-v2-job'],
                        wasPaused: false,
                    },
                ],
            })
            expect(queue.isPaused).toBe(true)
            await completeRestoreQuiescence(async function () {
                quiescenceMocks.setRestoreState(
                    getRestoreState('completed', '2026-08-11T09:00:00.000Z'),
                )
            })
            return 'single-v2-restored'
        })
        try {
            await expect(service.runRestoreQuiesced(operation)).resolves.toBe(
                'single-v2-restored',
            )

            expect(
                quiescenceMocks.queueConstructor.mock.calls.map(
                    ([name]) => name,
                ),
            ).toEqual([MAIL_QUEUE_NAME])
            expect(queue.remove).toHaveBeenCalledTimes(1)
            expect(queue.remove).toHaveBeenCalledWith('existing-v2-job')
            expect(queue.resume).toHaveBeenCalledTimes(1)
            expect(queue.isPaused).toBe(false)
            expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
            expect(quiescenceMocks.valkey.get).toHaveBeenCalledWith(
                'rentnerproxy-marketplace:mail:restore-quiescence:v1',
            )
            expect(quiescenceMocks.valkey.set).toHaveBeenCalledWith(
                'rentnerproxy-marketplace:mail:restore-quiescence:v1',
                expect.any(String),
                'NX',
            )
        } finally {
            await service.close()
        }
        expect(queue.close).toHaveBeenCalledTimes(1)
    })

    it.each(
        (['pausing', 'paused', 'purged'] as const).flatMap((phase) =>
            (
                [
                    null,
                    'running',
                    'failed',
                    'completed',
                    'recovery-required',
                ] as const
            ).map((restoreStatus) => ({ phase, restoreStatus })),
        ),
    )(
        'lässt einen alten Zwei-Queue-Record bei $phase/$restoreStatus unangetastet und hält v2 pausiert',
        async function ({ phase, restoreStatus }) {
            const serialized = setStoredTwoQueueQuiescence(phase)
            if (restoreStatus) {
                quiescenceMocks.setRestoreState(
                    getRestoreState(restoreStatus, '2026-08-11T09:00:00.000Z'),
                )
            }
            const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
            try {
                await expect(service.reconcileStartup()).rejects.toThrow(
                    'passt nicht zu den konfigurierten Queues',
                )

                expectOldQueueContractPreserved(serialized)
                await expect(service.isRestoreQuiescenceActive()).resolves.toBe(
                    true,
                )
                await expect(
                    service.isRestoreQuiescenceHealthyPaused(),
                ).resolves.toBe(false)
            } finally {
                await service.close()
            }
            expectOldQueueContractPreserved(serialized)
        },
    )

    it('führt bei einem alten Zwei-Queue-Record keinen neuen Restore aus', async function () {
        const serialized = setStoredTwoQueueQuiescence()
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        const operation = vi.fn(async function () {})
        try {
            await expect(service.runRestoreQuiesced(operation)).rejects.toThrow(
                'passt nicht zu den konfigurierten Queues',
            )

            expect(operation).not.toHaveBeenCalled()
            expectOldQueueContractPreserved(serialized)
        } finally {
            await service.close()
        }
    })

    it('interpretiert einen alten Record auch nach Valkey-Reconnect nicht als migrierten oder abgeschlossenen v2-Vertrag', async function () {
        const service = createService({ queueNames: [MAIL_QUEUE_NAME] })
        await service.reconcileStartup()
        service.startValkeyRecovery()
        const serialized = setStoredTwoQueueQuiescence('purged')
        quiescenceMocks.setRestoreState(
            getRestoreState('completed', '2026-08-11T09:00:00.000Z'),
        )

        quiescenceMocks.valkeyListeners.get('ready')?.()
        await service.close()

        expectOldQueueContractPreserved(serialized)
        expect(quiescenceMocks.valkey.off).toHaveBeenCalledWith(
            'ready',
            expect.any(Function),
        )
        expect(quiescenceMocks.valkeyListeners.has('ready')).toBe(false)
    })

    it('blockiert den echten Workerstart mit altem Zwei-Queue-State vor jeder Consumer-Anlage', async function () {
        const serialized = setStoredTwoQueueQuiescence('purged')
        quiescenceMocks.setRestoreState(
            getRestoreState('completed', '2026-08-11T09:00:00.000Z'),
        )

        await expect(startMailWorker()).rejects.toThrow(
            'passt nicht zu den konfigurierten Queues',
        )

        expect(quiescenceMocks.workerConstructor).not.toHaveBeenCalled()
        expectOldQueueContractPreserved(serialized)
        expect(
            quiescenceMocks.getQueueState(MAIL_QUEUE_NAME).close,
        ).toHaveBeenCalledTimes(1)
        expect(quiescenceMocks.valkey.on).not.toHaveBeenCalled()
    })

    it('ergänzt vor completed den Snapshot und löscht auch spät beendete Inflight-Jobs', async function () {
        const service = createService()
        const queueV2 = quiescenceMocks.getQueueState('mail-v2')
        const legacyQueue = quiescenceMocks.getQueueState('mail')
        queueV2.activeCounts = [1, 0]
        legacyQueue.activeCounts = [0, 0]
        queueV2.waitIds = ['old-waiting']
        queueV2.delayedIds = ['old-delayed']
        queueV2.prioritizedIds = ['old-prioritized']
        legacyQueue.waitIds = ['old-legacy']
        const operation = vi.fn(async function (completeRestoreQuiescence) {
            quiescenceMocks.order.push('restore')
            queueV2.pausedIds.push('late-inflight')
            await completeRestoreQuiescence(async function () {
                quiescenceMocks.order.push('publish-completed')
                queueV2.pausedIds.push('new-after-completed')
                quiescenceMocks.setRestoreState(
                    getRestoreState('completed', '2026-08-11T09:00:00.000Z'),
                )
            })
            return 'restored'
        })

        await expect(service.runRestoreQuiesced(operation)).resolves.toBe(
            'restored',
        )

        expect(operation).toHaveBeenCalledTimes(1)
        const restoreOrderIndex = quiescenceMocks.order.indexOf('restore')
        expect(quiescenceMocks.order.slice(0, restoreOrderIndex)).toEqual(
            expect.arrayContaining(['pause:mail-v2', 'pause:mail']),
        )
        expect(queueV2.remove.mock.calls.map(([id]) => id)).toEqual([
            'old-waiting',
            'old-delayed',
            'old-prioritized',
            'late-inflight',
        ])
        expect(legacyQueue.remove).toHaveBeenCalledWith('old-legacy')
        expect(queueV2.remove).toHaveBeenCalledWith('late-inflight')
        expect(queueV2.remove).not.toHaveBeenCalledWith('new-after-completed')
        expect(
            quiescenceMocks.order.indexOf('publish-completed'),
        ).toBeGreaterThan(
            quiescenceMocks.order.lastIndexOf('remove:mail-v2:old-prioritized'),
        )
        expect(queueV2.waitIds).toContain('new-after-completed')
        expect(queueV2.isPaused).toBe(false)
        expect(legacyQueue.isPaused).toBe(false)
        expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        await service.close()
    })

    it('startet den Restore bei einem Drain-Timeout nicht und gibt sicher frei', async function () {
        const service = createService({ timeoutMs: 1 })
        quiescenceMocks.getQueueState('mail-v2').activeCounts = [1, 1, 1]
        const operation = vi.fn(async function () {})

        await expect(service.runRestoreQuiesced(operation)).rejects.toThrow(
            'nicht innerhalb des Zeitlimits',
        )

        expect(operation).not.toHaveBeenCalled()
        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(false)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(false)
        expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        await service.close()
    })

    it('gibt nach bestätigtem Fehler ohne Purge frei', async function () {
        const service = createService()
        const queueV2 = quiescenceMocks.getQueueState('mail-v2')
        queueV2.waitIds = ['keep-after-rollback']
        const restoreError = new Error('Restore zurückgerollt')

        await expect(
            service.runRestoreQuiesced(async function () {
                quiescenceMocks.setRestoreState(
                    getRestoreState('failed', '2026-08-11T09:00:00.000Z'),
                )
                throw restoreError
            }),
        ).rejects.toBe(restoreError)

        expect(queueV2.remove).not.toHaveBeenCalled()
        expect(queueV2.waitIds).toContain('keep-after-rollback')
        expect(queueV2.isPaused).toBe(false)
        expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        await service.close()
    })

    it('lässt beide Queues bei recovery-required dauerhaft pausiert', async function () {
        const service = createService()
        const restoreError = new Error('Rollback unvollständig')

        await expect(
            service.runRestoreQuiesced(async function () {
                quiescenceMocks.setRestoreState(
                    getRestoreState(
                        'recovery-required',
                        '2026-08-11T09:00:00.000Z',
                    ),
                )
                throw restoreError
            }),
        ).rejects.toBe(restoreError)

        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(true)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(true)
        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await service.close()
    })

    it('bleibt nach Purge bei fehlgeschlagenem Completed-Marker fail-closed', async function () {
        const service = createService()
        const queueV2 = quiescenceMocks.getQueueState('mail-v2')
        queueV2.waitIds = ['already-purged']
        const markerError = new Error('Completed-Marker nicht schreibbar')

        await expect(
            service.runRestoreQuiesced(
                async function (completeRestoreQuiescence) {
                    await completeRestoreQuiescence(async function () {
                        throw markerError
                    })
                },
            ),
        ).rejects.toBe(markerError)

        expect(queueV2.remove).toHaveBeenCalledWith('already-purged')
        expect(queueV2.isPaused).toBe(true)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(true)
        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await service.close()
    })

    it('pausiert beim Startup vor lokalen Workern unter aktivem Marker', async function () {
        quiescenceMocks.setRestoreState(getRestoreState('running'))
        const service = createService()

        await service.reconcileStartup()

        expect(
            quiescenceMocks.getQueueState('mail-v2').pause,
        ).toHaveBeenCalled()
        expect(quiescenceMocks.getQueueState('mail').pause).toHaveBeenCalled()
        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(true)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(true)
        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await service.close()
    })

    it('hebt einen verwaisten Running-Marker erst unter freiem exklusivem Try-Lock auf recovery-required', async function () {
        setStoredRunningQuiescence()
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.tryExclusiveBarrier).toHaveBeenCalledTimes(1)
        expect(quiescenceMocks.writeRestoreState).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'recovery-required' }),
        )
        await expect(service.isRestoreQuiescenceHealthyPaused()).resolves.toBe(
            true,
        )
        await service.close()
    })

    it('stört einen legitimen Running-Marker vor Ablauf seiner Owner-Lease nicht', async function () {
        setStoredRunningQuiescence(Date.now() + 60_000)
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.tryExclusiveBarrier).not.toHaveBeenCalled()
        expect(quiescenceMocks.writeRestoreState).not.toHaveBeenCalled()
        await service.close()
    })

    it('stört einen legitimen Restore bei belegtem exklusivem Lock nicht', async function () {
        setStoredRunningQuiescence()
        quiescenceMocks.setTryLockAcquired(false)
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.tryExclusiveBarrier).toHaveBeenCalledTimes(1)
        expect(quiescenceMocks.writeRestoreState).not.toHaveBeenCalled()
        await service.close()
    })

    it('bleibt bei einem unlesbaren Restore-Marker fail-closed pausiert', async function () {
        quiescenceMocks.setRestoreState(new Error('Marker beschädigt'))
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(true)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(true)
        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await expect(service.isRestoreQuiescenceHealthyPaused()).resolves.toBe(
            false,
        )
        await service.close()
    })

    it('stellt die globale Pause nach Valkey-Verlust aus dem dauerhaften Marker wieder her', async function () {
        const service = createService()
        await service.reconcileStartup()
        service.startValkeyRecovery()
        quiescenceMocks.setRestoreState(getRestoreState('running'))

        quiescenceMocks.valkeyListeners.get('ready')?.()
        await waitForAssertion(function () {
            expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(true)
        })

        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(true)
        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await service.close()
    })

    it('reconciled nach Neustart einen abgeschlossenen Restore und purgt genau einmal', async function () {
        const baseline = getRestoreState('running')
        const completed = getRestoreState(
            'completed',
            '2026-08-11T09:00:00.000Z',
        )
        quiescenceMocks.setRestoreState(completed)
        quiescenceMocks.setStoredQuiescence(
            JSON.stringify({
                version: 1,
                token: '019f5b07-80e2-7000-8000-000000000001',
                phase: 'paused',
                ownerLeaseUntil: 0,
                restoreBaseline: {
                    kind: 'known',
                    state: {
                        startedAt: baseline.startedAt,
                        status: baseline.status,
                        updatedAt: baseline.updatedAt,
                    },
                },
                queues: [
                    {
                        name: 'mail-v2',
                        pendingJobIds: ['stale-v2'],
                        wasPaused: false,
                    },
                    {
                        name: 'mail',
                        pendingJobIds: ['stale-legacy'],
                        wasPaused: false,
                    },
                ],
            }),
        )
        const service = createService()

        await service.reconcileStartup()

        expect(
            quiescenceMocks.getQueueState('mail-v2').remove,
        ).toHaveBeenCalledTimes(1)
        expect(
            quiescenceMocks.getQueueState('mail').remove,
        ).toHaveBeenCalledTimes(1)
        expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        await service.close()
    })

    it('gibt einen abgeschlossenen Restore nach Ablauf einer übernommenen Owner-Lease ohne Valkey-Reconnect frei', async function () {
        const baseline = getRestoreState('running')
        const completed = getRestoreState(
            'completed',
            '2026-08-11T09:00:00.000Z',
        )
        quiescenceMocks.setRestoreState(completed)
        quiescenceMocks.setStoredQuiescence(
            JSON.stringify({
                version: 1,
                token: '019f5b07-80e2-7000-8000-000000000001',
                phase: 'purged',
                ownerLeaseUntil: Date.now() + 25,
                restoreBaseline: {
                    kind: 'known',
                    state: {
                        startedAt: baseline.startedAt,
                        status: baseline.status,
                        updatedAt: baseline.updatedAt,
                    },
                },
                queues: [
                    {
                        name: 'mail-v2',
                        pendingJobIds: [],
                        wasPaused: false,
                    },
                    {
                        name: 'mail',
                        pendingJobIds: [],
                        wasPaused: false,
                    },
                ],
            }),
        )
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(true)
        await waitForAssertion(function () {
            expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        })
        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(false)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(false)
        await service.close()
    })

    it('gibt eine verwaiste Quiesce ohne Restore-Marker nach Ablauf der Owner-Lease frei', async function () {
        quiescenceMocks.setStoredQuiescence(
            JSON.stringify({
                version: 1,
                token: '019f5b07-80e2-7000-8000-000000000001',
                phase: 'paused',
                ownerLeaseUntil: Date.now() + 25,
                restoreBaseline: { kind: 'known', state: null },
                queues: [
                    {
                        name: 'mail-v2',
                        pendingJobIds: [],
                        wasPaused: false,
                    },
                    {
                        name: 'mail',
                        pendingJobIds: [],
                        wasPaused: false,
                    },
                ],
            }),
        )
        const service = createService()

        await service.reconcileStartup()

        expect(quiescenceMocks.getStoredQuiescence()).not.toBeNull()
        await waitForAssertion(function () {
            expect(quiescenceMocks.getStoredQuiescence()).toBeNull()
        })
        expect(quiescenceMocks.getQueueState('mail-v2').isPaused).toBe(false)
        expect(quiescenceMocks.getQueueState('mail').isPaused).toBe(false)
        await service.close()
    })
})
