import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'
import { parseDatabaseEnvironment } from '@/server/Runtime/database-environment.service.ts'
import type { WorkerRuntimeStatus } from '@/server/Runtime/Types/worker-status.types.ts'

const appDatabaseUrl = 'postgres://app:test@127.0.0.1:9/app_test'
const workerDatabaseUrl = 'postgres://worker:test@127.0.0.1:9/worker_test'
const events: Array<string> = []
const policyUrls: Array<string> = []
const importedMailDatabaseUrls: Array<string | undefined> = []
let deriveWorkerDatabaseUrl = false
let applicationEnvironmentError: Error | null = null
let mailEnvironmentError: Error | null = null
let backupEnvironmentError: Error | null = null
let policyError: Error | null = null
let policyGate: Promise<void> = Promise.resolve()
let initializationGate: Promise<void> = Promise.resolve()
let initializationError: Error | null = null
let valkeyReadyGate: Promise<void> = Promise.resolve()
let mailStartupGate: Promise<void> = Promise.resolve()
let heartbeatStartupGate: Promise<void> = Promise.resolve()
const mailClose = vi.fn(async function () {})
const backupClose = vi.fn(async function () {})
const stopStatus = vi.fn(async function () {})
const signalListeners = {
    SIGINT: new Set(process.rawListeners('SIGINT')),
    SIGTERM: new Set(process.rawListeners('SIGTERM')),
}
let previousNodeEnvironment: string | undefined
let previousExitCode: typeof process.exitCode
const startupErrorLogger = vi.fn()
let heartbeatHealthCheck: (() => Promise<boolean>) | undefined
let heartbeatStatusReport: ((isHealthy: boolean) => Promise<void>) | undefined
const reportedStatuses: Array<WorkerRuntimeStatus> = []
const selectedStartupCase = process.env.DATABASE_ROLE_STARTUP_TEST_CASE

function startupTest(name: string, assertion: () => void | Promise<void>) {
    if (selectedStartupCase !== undefined) {
        if (selectedStartupCase === name) test(name, assertion)
        return
    }

    test(
        name,
        async function () {
            const child = Bun.spawn({
                cmd: [
                    process.execPath,
                    'test',
                    '--no-env-file',
                    '--isolate',
                    import.meta.path,
                ],
                cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
                env: {
                    NODE_ENV: 'test',
                    DATABASE_ROLE_STARTUP_TEST_CASE: name,
                },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
                timeout: 10_000,
            })
            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            if (exitCode !== 0) {
                throw new Error(
                    `Startup scenario failed (${exitCode}):\n${stdout}\n${stderr}`,
                )
            }
            expect(stdout + stderr).toMatch(/\b1 pass\b/u)
            expect(stdout + stderr).toMatch(/\b0 fail\b/u)
        },
        15_000,
    )
}

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        validateAppProductionEnvironment: function () {
            expect(process.env.NODE_ENV).toBe('production')
            events.push('app-environment-validated')
            if (applicationEnvironmentError) throw applicationEnvironmentError
            return { DATABASE_URL: appDatabaseUrl }
        },
        validateDatabaseEnvironment: function () {
            const environment = parseDatabaseEnvironment(process.env)
            process.env.DATABASE_URL = environment.DATABASE_URL
            return environment
        },
        validateMailWorkerEnvironment: function () {
            events.push('mail-environment-validated')
            if (mailEnvironmentError) throw mailEnvironmentError
            return {}
        },
        validateBackupWorkerEnvironment: function () {
            events.push('backup-environment-validated')
            if (backupEnvironmentError) throw backupEnvironmentError
            if (deriveWorkerDatabaseUrl) {
                const environment = parseDatabaseEnvironment(process.env)
                process.env.DATABASE_URL = environment.DATABASE_URL
                return environment
            }
            return { DATABASE_URL: workerDatabaseUrl }
        },
    }
})
vi.mock('@/server/Runtime/database-role-policy.service.ts', function () {
    return {
        assertRuntimeDatabaseRolePolicyService: async function (url: string) {
            events.push('database-policy-started')
            policyUrls.push(url)
            if (policyError) throw policyError
            await policyGate
            events.push('database-policy-completed')
        },
    }
})
vi.mock(
    '@/server/SystemBootstrap/database-initialization.service.ts',
    function () {
        return {
            runDatabaseInitializationService: async function (url: string) {
                events.push('database-initialization-started')
                const { assertRuntimeDatabaseRolePolicyService } =
                    await import('@/server/Runtime/database-role-policy.service.ts')
                await assertRuntimeDatabaseRolePolicyService(url)
                await initializationGate
                if (initializationError) throw initializationError
                events.push('database-initialization-completed')
                return null
            },
        }
    },
)
vi.mock('@/server/productionServer.ts', function () {
    events.push('production-server-imported')
    return {}
})
vi.mock('@/server/Queues/mail.worker.ts', function () {
    events.push('mail-worker-imported')
    importedMailDatabaseUrls.push(process.env.DATABASE_URL)
    return {
        startMailWorker: async function () {
            events.push('mail-consumer-started')
            await mailStartupGate
            return {
                close: mailClose,
                isRunning: () => true,
                isRestoreQuiescenceActive: async () => false,
                isRestoreQuiescenceHealthyPaused: async () => false,
                runRestoreQuiesced: async function () {},
            }
        },
    }
})
vi.mock('@/server/Admin/Backups/backup.worker.ts', function () {
    return {
        startBackupWorker: async function () {
            events.push('backup-consumer-started')
            return {
                close: backupClose,
                running: true,
                isRunning: function () {
                    return this.running
                },
            }
        },
    }
})
vi.mock('@/server/Runtime/worker-health.service.ts', function () {
    return {
        isBackgroundWorkerRuntimeHealthyService: async function (options: {
            isBackupWorkerRunning: (() => boolean) | null
        }) {
            return options.isBackupWorkerRunning?.() === true
        },
        startWorkerHeartbeatService: async function (options: {
            isHealthy: () => Promise<boolean>
            onHeartbeat?: (isHealthy: boolean) => Promise<void>
        }) {
            heartbeatHealthCheck = options.isHealthy
            heartbeatStatusReport = options.onHeartbeat
            events.push('heartbeat-started')
            await heartbeatStartupGate
            return { stop: async function () {} }
        },
    }
})
vi.mock('@/server/Runtime/worker-status.service.ts', function () {
    return {
        createWorkerStatusReporterService: function () {
            return {
                reportStatus: async function (status: WorkerRuntimeStatus) {
                    reportedStatuses.push(status)
                },
                stop: stopStatus,
            }
        },
    }
})
vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: startupErrorLogger, logInfo: vi.fn(), logWarn: vi.fn() }
})
vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: function () {
            throw new Error('A startup ordering test must not use Valkey.')
        },
    }
})
vi.mock('@/server/Valkey/valkey-availability.service.ts', function () {
    return {
        waitForValkeyReadyService: async function () {
            events.push('valkey-wait-started')
            await valkeyReadyGate
            events.push('valkey-ready')
        },
    }
})
vi.mock(
    '@/server/Storage/storage-mutation-barrier-health.service.ts',
    function () {
        return {
            installStorageMutationBarrierFatalExitHandlerService: function () {
                events.push('storage-fatal-handler-installed')
            },
            isStorageMutationBarrierHealthyService: () => true,
        }
    },
)

async function importApplicationEntrypoint() {
    await import('@/server/productionEntrypoint.ts')
}

async function importBackgroundWorker() {
    await import('@/server/backgroundWorker.ts')
}

function expectNoConsumersOrHeartbeat() {
    expect(events).not.toContain('mail-worker-imported')
    expect(events).not.toContain('mail-consumer-started')
    expect(events).not.toContain('backup-consumer-started')
    expect(events).not.toContain('heartbeat-started')
    expect(reportedStatuses).toEqual([])
}

beforeEach(function () {
    events.length = 0
    policyUrls.length = 0
    importedMailDatabaseUrls.length = 0
    deriveWorkerDatabaseUrl = false
    applicationEnvironmentError = null
    mailEnvironmentError = null
    backupEnvironmentError = null
    policyError = null
    policyGate = Promise.resolve()
    initializationGate = Promise.resolve()
    initializationError = null
    valkeyReadyGate = Promise.resolve()
    mailStartupGate = Promise.resolve()
    heartbeatStartupGate = Promise.resolve()
    mailClose.mockReset().mockResolvedValue(undefined)
    backupClose.mockReset().mockResolvedValue(undefined)
    stopStatus.mockReset().mockResolvedValue(undefined)
    heartbeatHealthCheck = undefined
    heartbeatStatusReport = undefined
    reportedStatuses.length = 0
    previousNodeEnvironment = process.env.NODE_ENV
    previousExitCode = process.exitCode
    startupErrorLogger.mockClear()
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = workerDatabaseUrl
    vi.spyOn(process, 'once').mockImplementation(() => process)
})

afterEach(function () {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.rawListeners(signal)) {
            if (!signalListeners[signal].has(listener))
                process.removeListener(signal, listener)
        }
    }
    process.exitCode = previousExitCode ?? 0
    if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
    } else {
        process.env.NODE_ENV = previousNodeEnvironment
    }
    vi.restoreAllMocks()
})

describe('Application database policy startup barrier', function () {
    startupTest(
        'rejects an invalid environment before querying or importing the server',
        async function () {
            applicationEnvironmentError = new Error(
                'Invalid test app environment',
            )
            await expect(importApplicationEntrypoint()).resolves.toBeUndefined()
            expect(process.exitCode).toBe(1)
            expect(startupErrorLogger).toHaveBeenCalledWith(
                'production.startup_failed',
                applicationEnvironmentError,
            )
            expect(events).toEqual(['app-environment-validated'])
            expect(policyUrls).toEqual([])
        },
    )

    startupTest(
        'logs a denied database role and sets a failure exit code without importing the server',
        async function () {
            policyError = new Error('Denied test database role')
            await expect(importApplicationEntrypoint()).resolves.toBeUndefined()
            expect(process.exitCode).toBe(1)
            expect(startupErrorLogger).toHaveBeenCalledWith(
                'production.startup_failed',
                policyError,
            )
            expect(events).toEqual([
                'app-environment-validated',
                'database-initialization-started',
                'database-policy-started',
            ])
            expect(policyUrls).toEqual([appDatabaseUrl])
        },
    )

    startupTest(
        'waits for the validated database role before importing the server',
        async function () {
            const gate = Promise.withResolvers<void>()
            policyGate = gate.promise
            const started = importApplicationEntrypoint()
            try {
                await waitForAssertion(function () {
                    expect(events).toContain('database-policy-started')
                })
                expect(events).not.toContain('production-server-imported')
            } finally {
                gate.resolve()
                await started
            }
            expect(events).toEqual([
                'app-environment-validated',
                'database-initialization-started',
                'database-policy-started',
                'database-policy-completed',
                'database-initialization-completed',
                'production-server-imported',
            ])
            expect(policyUrls).toEqual([appDatabaseUrl])
        },
    )

    startupTest(
        'waits for database initialization after role approval before importing the server',
        async function () {
            const gate = Promise.withResolvers<void>()
            initializationGate = gate.promise
            const started = importApplicationEntrypoint()
            try {
                await waitForAssertion(function () {
                    expect(events).toContain('database-policy-completed')
                })
                expect(events).not.toContain(
                    'database-initialization-completed',
                )
                expect(events).not.toContain('production-server-imported')
            } finally {
                gate.resolve()
                await started
            }
            expect(events).toEqual([
                'app-environment-validated',
                'database-initialization-started',
                'database-policy-started',
                'database-policy-completed',
                'database-initialization-completed',
                'production-server-imported',
            ])
            expect(policyUrls).toEqual([appDatabaseUrl])
            expect(startupErrorLogger).not.toHaveBeenCalled()
        },
    )

    startupTest(
        'logs a failed initialization and sets a failure exit code without importing the server',
        async function () {
            initializationError = new Error(
                'Synthetic migration failure postgres://app:synthetic-secret@db/app_test',
            )
            await expect(importApplicationEntrypoint()).resolves.toBeUndefined()
            expect(process.exitCode).toBe(1)
            expect(startupErrorLogger).toHaveBeenCalledWith(
                'production.startup_failed',
                initializationError,
            )
            expect(events).toEqual([
                'app-environment-validated',
                'database-initialization-started',
                'database-policy-started',
                'database-policy-completed',
            ])
            expect(policyUrls).toEqual([appDatabaseUrl])
        },
    )
})

describe('Worker database policy startup barrier', function () {
    startupTest(
        'logs the startup error before cleaning up a failed mail consumer start',
        async function () {
            process.env.NODE_ENV = 'development'
            const error = new Error('Synthetic mail consumer startup failure')
            mailStartupGate = Promise.reject(error)
            void mailStartupGate.catch(() => undefined)
            await expect(importBackgroundWorker()).rejects.toBe(error)
            expect(startupErrorLogger).toHaveBeenCalledWith(
                'background_worker.start_failed',
                error,
            )
            expect(stopStatus).toHaveBeenCalledTimes(1)
            expect(events).not.toContain('heartbeat-started')
        },
    )

    startupTest(
        'resolves PostgreSQL parts during development before importing consumers',
        async function () {
            process.env.NODE_ENV = 'development'
            const environment = {
                DATABASE_URL: '',
                POSTGRES_HOST: '127.0.0.1',
                POSTGRES_PORT: '5432',
                POSTGRES_USER: 'local-worker',
                POSTGRES_PASSWORD: 'local:p@ss',
                POSTGRES_DB: 'worker_test',
            }
            const previousValues = Object.entries(environment).map(
                ([key]) => [key, process.env[key]] as const,
            )
            try {
                Object.assign(process.env, environment)
                await importBackgroundWorker()
                expect(importedMailDatabaseUrls).toEqual([
                    'postgresql://local-worker:local%3Ap%40ss@127.0.0.1:5432/worker_test',
                ])
                expect(policyUrls).toEqual([])
                expect(events).toContain('heartbeat-started')
            } finally {
                for (const [key, value] of previousValues) {
                    if (value === undefined) delete process.env[key]
                    else process.env[key] = value
                }
            }
        },
    )

    startupTest(
        'drains a mail worker created during startup after repeated stop signals',
        async function () {
            const startedMail = Promise.withResolvers<void>()
            const finishedMail = Promise.withResolvers<void>()
            mailStartupGate = startedMail.promise
            mailClose.mockReturnValueOnce(finishedMail.promise)
            const exit = vi
                .spyOn(process, 'exit')
                .mockImplementation(() => undefined as never)
            const started = importBackgroundWorker()
            await waitForAssertion(() =>
                expect(events).toContain('mail-consumer-started'),
            )
            for (const signal of ['SIGTERM', 'SIGINT'] as const) {
                const listener = process
                    .rawListeners(signal)
                    .find((entry) => !signalListeners[signal].has(entry))
                if (!listener)
                    throw new Error(
                        'Worker shutdown handler missing during startup',
                    )
                Reflect.apply(listener, process, [])
            }
            expect(exit).not.toHaveBeenCalled()
            startedMail.resolve()
            await started
            await waitForAssertion(() =>
                expect(mailClose).toHaveBeenCalledTimes(1),
            )
            expect(events).not.toContain('backup-consumer-started')
            expect(events).not.toContain('heartbeat-started')
            expect(exit).not.toHaveBeenCalled()
            finishedMail.resolve()
            await waitForAssertion(() => expect(exit).toHaveBeenCalledWith(0))
            expect(exit).toHaveBeenCalledTimes(1)
            expect(stopStatus).toHaveBeenCalledTimes(1)
        },
    )

    startupTest(
        'can stop owned consumers while the first heartbeat probe is still pending',
        async function () {
            const heartbeatReady = Promise.withResolvers<void>()
            heartbeatStartupGate = heartbeatReady.promise
            const closeOrder: string[] = []
            backupClose.mockImplementationOnce(async function () {
                closeOrder.push('backup')
            })
            mailClose.mockImplementationOnce(async function () {
                closeOrder.push('mail')
            })
            const exit = vi
                .spyOn(process, 'exit')
                .mockImplementation(() => undefined as never)
            const started = importBackgroundWorker()
            try {
                await waitForAssertion(() =>
                    expect(events).toContain('heartbeat-started'),
                )
                const listener = process
                    .rawListeners('SIGTERM')
                    .find((entry) => !signalListeners.SIGTERM.has(entry))
                if (!listener)
                    throw new Error('Worker shutdown handler missing')
                Reflect.apply(listener, process, [])
                await waitForAssertion(() =>
                    expect(exit).toHaveBeenCalledWith(0),
                )
                expect(closeOrder).toEqual(['backup', 'mail'])
                expect(stopStatus).toHaveBeenCalledTimes(1)
            } finally {
                heartbeatReady.resolve()
                await started
            }
        },
    )

    startupTest(
        'resolves PostgreSQL credentials before importing mail worker database dependencies',
        async function () {
            const connectionEnvironment = {
                DATABASE_URL: '',
                POSTGRES_HOST: 'db',
                POSTGRES_PORT: '5432',
                POSTGRES_USER: 'worker@tenant',
                POSTGRES_PASSWORD: 'p@ss:/?#% word',
                POSTGRES_DB: 'worker/test',
            }
            const previousValues = new Map(
                Object.keys(connectionEnvironment).map(
                    (key) => [key, process.env[key]] as const,
                ),
            )
            const expectedDatabaseUrl =
                'postgresql://worker%40tenant:p%40ss%3A%2F%3F%23%25%20word@db:5432/worker%2Ftest'

            try {
                Object.assign(process.env, connectionEnvironment)
                deriveWorkerDatabaseUrl = true
                await import('@/server/productionWorkerEntrypoint.ts')

                expect(policyUrls).toEqual([expectedDatabaseUrl])
                expect(importedMailDatabaseUrls).toEqual([expectedDatabaseUrl])
            } finally {
                for (const [key, value] of previousValues) {
                    if (value === undefined) {
                        delete process.env[key]
                    } else {
                        process.env[key] = value
                    }
                }
            }
        },
    )

    startupTest(
        'preserves the backup worker receiver when checking heartbeat health',
        async function () {
            process.env.NODE_ENV = 'development'
            await importBackgroundWorker()
            expect(heartbeatHealthCheck).toBeDefined()
            await expect(heartbeatHealthCheck!()).resolves.toBe(true)
            expect(reportedStatuses).toEqual(['starting'])
            expect(heartbeatStatusReport).toBeDefined()
            await heartbeatStatusReport!(true)
            expect(reportedStatuses).toEqual(['starting', 'running'])
        },
    )

    startupTest(
        'rejects invalid mail configuration before querying or starting consumers',
        async function () {
            mailEnvironmentError = new Error('Invalid test mail environment')
            await expect(importBackgroundWorker()).rejects.toBe(
                mailEnvironmentError,
            )
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'mail-environment-validated',
            ])
            expect(policyUrls).toEqual([])
            expectNoConsumersOrHeartbeat()
        },
    )

    startupTest(
        'rejects invalid backup configuration before querying or starting consumers',
        async function () {
            backupEnvironmentError = new Error(
                'Invalid test backup environment',
            )
            await expect(importBackgroundWorker()).rejects.toBe(
                backupEnvironmentError,
            )
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'mail-environment-validated',
                'backup-environment-validated',
            ])
            expect(policyUrls).toEqual([])
            expectNoConsumersOrHeartbeat()
        },
    )

    startupTest(
        'fails closed for a denied database role before any consumer or heartbeat',
        async function () {
            policyError = new Error('Denied test worker database role')
            await expect(importBackgroundWorker()).rejects.toBe(policyError)
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'mail-environment-validated',
                'backup-environment-validated',
                'database-policy-started',
            ])
            expect(policyUrls).toEqual([workerDatabaseUrl])
            expectNoConsumersOrHeartbeat()
        },
    )

    startupTest(
        'waits for database approval before starting both consumers and the heartbeat',
        async function () {
            const gate = Promise.withResolvers<void>()
            policyGate = gate.promise
            const started = importBackgroundWorker()
            try {
                await waitForAssertion(function () {
                    expect(events).toContain('database-policy-started')
                })
                expectNoConsumersOrHeartbeat()
            } finally {
                gate.resolve()
                await started
            }
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'mail-environment-validated',
                'backup-environment-validated',
                'database-policy-started',
                'database-policy-completed',
                'valkey-wait-started',
                'valkey-ready',
                'mail-worker-imported',
                'mail-consumer-started',
                'backup-consumer-started',
                'heartbeat-started',
            ])
            expect(policyUrls).toEqual([workerDatabaseUrl])
        },
    )

    startupTest(
        'preserves development mode without production role enforcement',
        async function () {
            process.env.NODE_ENV = 'development'
            await importBackgroundWorker()
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'valkey-wait-started',
                'valkey-ready',
                'mail-worker-imported',
                'mail-consumer-started',
                'backup-consumer-started',
                'heartbeat-started',
            ])
            expect(policyUrls).toEqual([])
        },
    )

    startupTest(
        'waits for Valkey after database approval before starting any consumer',
        async function () {
            const gate = Promise.withResolvers<void>()
            valkeyReadyGate = gate.promise
            const started = importBackgroundWorker()
            try {
                await waitForAssertion(function () {
                    expect(events).toContain('valkey-wait-started')
                })
                expect(events).toContain('database-policy-completed')
                expectNoConsumersOrHeartbeat()
            } finally {
                gate.resolve()
                await started
            }
            expect(events).toContain('mail-consumer-started')
            expect(events).toContain('backup-consumer-started')
            expect(events).toContain('heartbeat-started')
        },
    )

    startupTest(
        'keeps development startup pending until Valkey reconnects',
        async function () {
            process.env.NODE_ENV = 'development'
            const gate = Promise.withResolvers<void>()
            valkeyReadyGate = gate.promise
            const started = importBackgroundWorker()
            try {
                await waitForAssertion(function () {
                    expect(events).toContain('valkey-wait-started')
                })
                expect(policyUrls).toEqual([])
                expectNoConsumersOrHeartbeat()
            } finally {
                gate.resolve()
                await started
            }
            expect(events).toContain('mail-consumer-started')
            expect(events).toContain('backup-consumer-started')
        },
    )

    startupTest(
        'the production worker entrypoint enforces production mode before the same database barrier',
        async function () {
            process.env.NODE_ENV = 'development'
            policyError = new Error(
                'Denied test production worker database role',
            )
            await expect(
                import('@/server/productionWorkerEntrypoint.ts'),
            ).rejects.toBe(policyError)
            expect(process.env.NODE_ENV).toBe('production')
            expect(events).toEqual([
                'storage-fatal-handler-installed',
                'mail-environment-validated',
                'backup-environment-validated',
                'database-policy-started',
            ])
            expect(policyUrls).toEqual([workerDatabaseUrl])
            expectNoConsumersOrHeartbeat()
        },
    )
})
