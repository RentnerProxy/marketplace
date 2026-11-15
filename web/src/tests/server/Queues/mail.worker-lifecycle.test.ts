import type { CompleteRestoreQuiescence } from '@/server/Queues/Types/mail-restore-quiescence.types.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { MAIL_QUEUE_NAME } from '@/server/Queues/mail.queue.ts'
import { createMailJobEnvelope } from '@/server/Queues/mail-payload.ts'
import { sanitizeLogContextService } from '@/server/Logging/log-context.ts'
import { startMailWorker } from '@/server/Queues/mail.worker.ts'

import type {
    MailWorkerTestInstance,
    MailWorkerTestProcessor,
} from './mail.worker-lifecycle.test.types.ts'

const bullMqMocks = (function () {
    return {
        workers: [] as Array<MailWorkerTestInstance>,
        order: [] as Array<string>,
        connection: { host: 'isolated-mail-worker' },
        queueConstructor: vi.fn(function (_name: string, _options: unknown) {}),
    }
})()

const loggerMocks = {
    logError: vi.fn(function (
        _event: string,
        _error: unknown,
        _metadata?: unknown,
    ) {}),
    logInfo: vi.fn(function () {}),
    logWarn: vi.fn(function () {}),
}
const deliveryMocks = {
    sendFailedLoginAlertMail: vi.fn(async function () {}),
    sendSecurityChangeMail: vi.fn(async function () {}),
    sendPasswordResetMail: vi.fn(async function () {}),
    sendPasswordSetupMail: vi.fn(async function () {}),
}
const quiescenceServiceMocks = {
    close: vi.fn(async function () {}),
    isRestoreQuiescenceActive: vi.fn(async function () {
        return false
    }),
    isRestoreQuiescenceHealthyPaused: vi.fn(async function () {
        return false
    }),
    reconcileStartup: vi.fn(async function () {
        bullMqMocks.order.push('quiescence:reconciled')
    }),
    runRestoreQuiesced: vi.fn(async function <TResult>(
        operation: (
            completeRestoreQuiescence: CompleteRestoreQuiescence,
        ) => Promise<TResult>,
    ) {
        return operation(async function (publishCompletedState) {
            await publishCompletedState()
        })
    }),
    startValkeyRecovery: vi.fn(function () {
        bullMqMocks.order.push('valkey:recovery-started')
    }),
}
const createQuiescence = vi.fn(function (_input: unknown) {
    bullMqMocks.order.push('quiescence:create')
    return quiescenceServiceMocks
})

function MockQueue(name: string, options: unknown) {
    bullMqMocks.queueConstructor(name, options)
}

vi.mock('bullmq', function () {
    return {
        Queue: MockQueue,
        Worker: class {
            close = vi.fn(async function () {})
            isRunning = vi.fn(function () {
                return true
            })
            listeners = new Map<string, (...args: unknown[]) => void>()

            constructor(
                name: string,
                processor: MailWorkerTestProcessor,
                options: unknown,
            ) {
                bullMqMocks.order.push(`worker:${name}`)
                bullMqMocks.workers.push({
                    close: this.close,
                    isRunning: this.isRunning,
                    name,
                    options,
                    processor,
                    listeners: this.listeners,
                })
            }

            on(event: string, listener: (...args: unknown[]) => void) {
                this.listeners.set(event, listener)
                return this
            }
        },
    }
})
vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getBullMqConnectionOptions: vi.fn(function () {
            return bullMqMocks.connection
        }),
        getBullMqProducerConnectionOptions: vi.fn(function () {
            return bullMqMocks.connection
        }),
    }
})
vi.mock('@/server/Logging/logger.ts', function () {
    return loggerMocks
})
vi.mock('@/server/Queues/mail-restore-quiescence.service.ts', function () {
    return { createMailRestoreQuiescenceService: createQuiescence }
})
vi.mock('@/lib/Mail/mail.ts', function () {
    return deliveryMocks
})
vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return {
        isRestoreStateActiveService: vi.fn(async function () {
            return false
        }),
    }
})
vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function (key: string) {
            if (key !== 'AUTH_ENCRYPTION_KEY')
                throw new Error('Unexpected test environment request')
            return Buffer.alloc(32, 9).toString('base64')
        },
    }
})

const mockedLogError = loggerMocks.logError

function getWorker() {
    expect(bullMqMocks.workers).toHaveLength(1)
    const worker = bullMqMocks.workers[0]
    if (!worker) throw new Error('Mail worker was not started')
    return worker
}

describe('V2-Mail-Worker-Lifecycle', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        bullMqMocks.workers.length = 0
        bullMqMocks.order.length = 0
        quiescenceServiceMocks.close.mockReset().mockResolvedValue(undefined)
        quiescenceServiceMocks.isRestoreQuiescenceActive
            .mockReset()
            .mockResolvedValue(false)
        quiescenceServiceMocks.isRestoreQuiescenceHealthyPaused
            .mockReset()
            .mockResolvedValue(false)
    })

    it('startet nach Recovery genau einen v2-Worker mit Concurrency 5 und zählt keine Klartextqueue', async function () {
        const mailWorker = await startMailWorker()
        const worker = getWorker()

        expect(worker.name).toBe(MAIL_QUEUE_NAME)
        expect(worker.options).toEqual({
            concurrency: 5,
            connection: bullMqMocks.connection,
        })
        expect(createQuiescence).toHaveBeenCalledTimes(1)
        expect(createQuiescence).toHaveBeenCalledWith({
            queueNames: [MAIL_QUEUE_NAME],
        })
        expect(bullMqMocks.queueConstructor).not.toHaveBeenCalled()
        expect(loggerMocks.logInfo).not.toHaveBeenCalled()
        expect(bullMqMocks.order).toEqual([
            'quiescence:create',
            'quiescence:reconciled',
            'valkey:recovery-started',
            `worker:${MAIL_QUEUE_NAME}`,
        ])

        await mailWorker.close()
        expect(worker.close).toHaveBeenCalledTimes(1)
        expect(quiescenceServiceMocks.close).toHaveBeenCalledTimes(1)
    })

    it('wartet vor der Worker-Anlage auf die Startup-Reconciliation', async function () {
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        quiescenceServiceMocks.reconcileStartup.mockImplementationOnce(
            async function () {
                entered.resolve()
                await release.promise
            },
        )
        const starting = startMailWorker()
        void starting.then(
            () =>
                entered.reject(
                    new Error('Worker started without awaiting reconciliation'),
                ),
            (error: unknown) => entered.reject(error),
        )
        await entered.promise
        try {
            expect(bullMqMocks.workers).toHaveLength(0)
            expect(
                quiescenceServiceMocks.startValkeyRecovery,
            ).not.toHaveBeenCalled()
        } finally {
            release.resolve()
            await (await starting).close()
        }
        expect(bullMqMocks.workers).toHaveLength(1)
    })

    it.each(['reconciliation', 'valkey-recovery'] as const)(
        'startet nach einem Fehler bei %s keinen Worker und schließt Quiescence',
        async function (phase) {
            const error = new Error('startup recovery unavailable')
            if (phase === 'reconciliation') {
                quiescenceServiceMocks.reconcileStartup.mockRejectedValueOnce(
                    error,
                )
            } else {
                quiescenceServiceMocks.startValkeyRecovery.mockImplementationOnce(
                    function () {
                        throw error
                    },
                )
            }

            await expect(startMailWorker()).rejects.toBe(error)

            expect(bullMqMocks.workers).toHaveLength(0)
            expect(quiescenceServiceMocks.close).toHaveBeenCalledTimes(1)
            expect(bullMqMocks.queueConstructor).not.toHaveBeenCalled()
        },
    )

    it('liefert Running-Health ausschließlich vom aktiven v2-Worker', async function () {
        const mailWorker = await startMailWorker()
        const worker = getWorker()

        worker.isRunning.mockReturnValueOnce(true).mockReturnValueOnce(false)
        expect(mailWorker.isRunning()).toBe(true)
        expect(mailWorker.isRunning()).toBe(false)
        expect(worker.isRunning).toHaveBeenCalledTimes(2)
        expect(mailWorker.isRestoreQuiescenceActive).toBe(
            quiescenceServiceMocks.isRestoreQuiescenceActive,
        )
        expect(mailWorker.isRestoreQuiescenceHealthyPaused).toBe(
            quiescenceServiceMocks.isRestoreQuiescenceHealthyPaused,
        )
        expect(
            Object.is(
                mailWorker.runRestoreQuiesced,
                quiescenceServiceMocks.runRestoreQuiesced,
            ),
        ).toBe(true)
        quiescenceServiceMocks.isRestoreQuiescenceActive.mockResolvedValueOnce(
            true,
        )
        quiescenceServiceMocks.isRestoreQuiescenceHealthyPaused.mockResolvedValueOnce(
            true,
        )
        await expect(mailWorker.isRestoreQuiescenceActive()).resolves.toBe(true)
        await expect(
            mailWorker.isRestoreQuiescenceHealthyPaused(),
        ).resolves.toBe(true)
        await expect(
            mailWorker.runRestoreQuiesced(async function () {
                return 42
            }),
        ).resolves.toBe(42)
        await mailWorker.close()
    })

    it.each(['worker', 'quiescence'] as const)(
        'versucht bei einem %s-Closefehler weiterhin beide Abschlüsse',
        async function (failingClose) {
            const mailWorker = await startMailWorker()
            const worker = getWorker()
            const error = new Error('close failed')
            if (failingClose === 'worker') {
                worker.close.mockRejectedValueOnce(error)
            } else {
                quiescenceServiceMocks.close.mockRejectedValueOnce(error)
            }

            await expect(mailWorker.close()).rejects.toBe(error)

            expect(worker.close).toHaveBeenCalledTimes(1)
            expect(quiescenceServiceMocks.close).toHaveBeenCalledTimes(1)
        },
    )

    it('hält die Restore-Quiescence bis zum Ende eines aktiven Mail-Processors offen', async function () {
        const delivered = Promise.withResolvers<void>()
        deliveryMocks.sendPasswordSetupMail.mockReturnValueOnce(
            delivered.promise,
        )
        const mailWorker = await startMailWorker()
        const worker = getWorker()
        const processing = worker.processor({
            name: 'password-setup',
            data: await createMailJobEnvelope({
                kind: 'password-setup',
                to: 'setup@example.test',
                username: 'test-user',
                resetLink:
                    'https://app.example.test/reset?token=synthetic-token',
            }),
        })
        const stopping = mailWorker.close()
        expect(quiescenceServiceMocks.close).not.toHaveBeenCalled()
        delivered.resolve()
        await processing
        await stopping
        expect(deliveryMocks.sendPasswordSetupMail).toHaveBeenCalledTimes(1)
        expect(quiescenceServiceMocks.close).toHaveBeenCalledTimes(1)
    })

    it('verdrahtet den einzigen Processor mit echter v2-Entschlüsselung und verweigert gültigen Klartext', async function () {
        const mailWorker = await startMailWorker()
        const worker = getWorker()
        const plaintext = {
            kind: 'password-setup' as const,
            to: 'setup@example.test',
            username: 'test-user',
            resetLink: 'https://app.example.test/reset?token=synthetic-token',
        }

        await worker.processor({
            name: 'password-setup',
            data: await createMailJobEnvelope(plaintext),
        })
        expect(deliveryMocks.sendPasswordSetupMail).toHaveBeenCalledTimes(1)
        await expect(
            worker.processor({ name: 'password-setup', data: plaintext }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
        expect(deliveryMocks.sendPasswordSetupMail).toHaveBeenCalledTimes(1)
        expect(deliveryMocks.sendPasswordResetMail).not.toHaveBeenCalled()
        expect(deliveryMocks.sendFailedLoginAlertMail).not.toHaveBeenCalled()
        await mailWorker.close()
    })

    it.each([MAIL_QUEUE_NAME])(
        'erhält sichere Job-Korrelation und Fehlerereignisse für %s',
        async function (queueName) {
            await startMailWorker()
            const worker = bullMqMocks.workers.find(
                (candidate) => candidate.name === queueName,
            )
            const onFailed = worker?.listeners.get('failed')
            const onError = worker?.listeners.get('error')
            if (!onFailed || !onError) {
                throw new Error('Mail-Worker-Logging wurde nicht registriert.')
            }
            const error = new Error('550 victim@example.test raw-token')
            const examples = [
                { id: '0', name: 'password-reset' },
                { id: '12345678901234567890', name: 'password-setup' },
                {
                    id: '01900000-0000-7000-8000-000000000001',
                    name: 'failed-login-alert',
                },
                {
                    id: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
                    name: 'security-change',
                },
            ]

            for (const job of examples) {
                onFailed(job, error)
                expect(mockedLogError).toHaveBeenLastCalledWith(
                    'mail.job.failed',
                    error,
                    { jobId: job.id, jobName: job.name, queueName },
                )
            }

            onError(error)
            expect(mockedLogError).toHaveBeenLastCalledWith(
                'mail.worker.error',
                error,
                { queueName },
            )
        },
    )

    it('verwirft fremde Jobnamen und nichtkanonische Job-IDs vor dem Logger', async function () {
        await startMailWorker()
        const onFailed = bullMqMocks.workers
            .find((worker) => worker.name === MAIL_QUEUE_NAME)
            ?.listeners.get('failed')
        if (!onFailed) {
            throw new Error('Mail-Worker-Logging wurde nicht registriert.')
        }
        const error = new Error('mail failed')
        const invalidIds = [
            '',
            'victim@example.test',
            'raw-token',
            '123\n',
            '01',
            '123456789012345678901',
            '01900000-ABCD-7000-8000-000000000001',
            '01900000-0000-7000-8000-000000000001\n',
            '01900000-0000-9000-8000-000000000001',
            '01900000-0000-7000-0000-000000000001',
        ]

        for (const id of invalidIds) {
            onFailed({ id, name: 'victim@example.test raw-token' }, error)
            expect(mockedLogError).toHaveBeenLastCalledWith(
                'mail.job.failed',
                error,
                {
                    jobId: undefined,
                    jobName: undefined,
                    queueName: MAIL_QUEUE_NAME,
                },
            )
        }

        onFailed({ id: '12', name: 'password-reset\n' }, error)
        expect(mockedLogError).toHaveBeenLastCalledWith(
            'mail.job.failed',
            error,
            { jobId: '12', jobName: undefined, queueName: MAIL_QUEUE_NAME },
        )
        onFailed(undefined, error)
        expect(mockedLogError).toHaveBeenLastCalledWith(
            'mail.job.failed',
            error,
            {
                jobId: undefined,
                jobName: undefined,
                queueName: MAIL_QUEUE_NAME,
            },
        )
    })

    it('verdrahtet Sicherheitsjobs mit dem bestehenden einzigen v2-Processor', async function () {
        const mailWorker = await startMailWorker()
        const worker = getWorker()
        const input = {
            to: 'previous-contact@example.test',
            change: 'totp_disabled' as const,
            changedAt: '2026-09-06T01:02:03.004Z',
            auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
        }
        await worker.processor({
            name: 'security-change',
            data: await createMailJobEnvelope({
                ...input,
                kind: 'security-change',
            }),
        })
        expect(deliveryMocks.sendSecurityChangeMail).toHaveBeenCalledWith(input)
        expect(deliveryMocks.sendSecurityChangeMail).toHaveBeenCalledTimes(1)
        expect(deliveryMocks.sendPasswordSetupMail).not.toHaveBeenCalled()
        expect(deliveryMocks.sendPasswordResetMail).not.toHaveBeenCalled()
        expect(deliveryMocks.sendFailedLoginAlertMail).not.toHaveBeenCalled()
        await mailWorker.close()
    })

    it('erlaubt nur den festen Sicherheitsjobnamen und sichere Korrelation im Log-Kontext', () => {
        expect(
            sanitizeLogContextService({
                jobName: 'security-change',
                jobId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
                queueName: MAIL_QUEUE_NAME,
                to: 'private@example.test',
                username: 'private-user',
                changedAt: '2026-09-06T01:02:03.004Z',
                resetLink: 'https://app.example.test/reset?token=synthetic',
            }),
        ).toEqual({
            jobName: 'security-change',
            jobId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
            queueName: MAIL_QUEUE_NAME,
        })
        expect(
            sanitizeLogContextService({
                jobName: 'security-change\n',
                jobId: 'private@example.test',
            }),
        ).toEqual({})
    })
})
