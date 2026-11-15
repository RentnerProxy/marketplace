import { describe, expect, test, vi } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const selectedCase = process.env.PRODUCTION_INITIALIZATION_TEST_CASE
const databaseUrl =
    'postgresql://postgres:synthetic-private-password@db.invalid/app_test'
const events: string[] = []
let environmentError: Error | undefined
let initializationError: Error | undefined
let initializationGate = Promise.resolve()
const logError = vi.fn()

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        validateDatabaseEnvironment: function () {
            expect(process.env.NODE_ENV).toBe('production')
            events.push('environment')
            if (environmentError) throw environmentError
            return { DATABASE_URL: databaseUrl }
        },
    }
})
vi.mock(
    '@/server/SystemBootstrap/database-initialization.service.ts',
    function () {
        return {
            runDatabaseInitializationService: async function (url: string) {
                expect(url).toBe(databaseUrl)
                events.push('initialization-started')
                await initializationGate
                if (initializationError) throw initializationError
                events.push('initialization-completed')
            },
        }
    },
)
vi.mock('@/server/Logging/logger.ts', function () {
    return { logError }
})

function initializationTest(
    name: string,
    expectedExitCode: number,
    assertion: () => Promise<void>,
) {
    if (selectedCase !== undefined) {
        if (selectedCase === name) test(name, assertion)
        return
    }

    test(
        name,
        async function () {
            const child = Bun.spawn({
                cmd: [
                    process.execPath,
                    '--no-env-file',
                    'test',
                    '--isolate',
                    import.meta.path,
                ],
                cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
                env: {
                    NODE_ENV: 'development',
                    PRODUCTION_INITIALIZATION_TEST_CASE: name,
                },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
                timeout: 10_000,
                windowsHide: true,
            })
            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            expect(exitCode).toBe(expectedExitCode)
            expect(stdout + stderr).toMatch(/\b1 pass\b/u)
            expect(stdout + stderr).toMatch(/\b0 fail\b/u)
            expect(stdout + stderr).not.toContain('synthetic-private-password')
            expect(stdout + stderr).not.toContain(databaseUrl)
        },
        15_000,
    )
}

describe('Produktionsinitialisierung CLI-Vertrag', function () {
    initializationTest(
        'validiert vor Initialisierung im Produktionsmodus und endet erfolgreich',
        0,
        async function () {
            await import('@/server/SystemBootstrap/initialize-production.ts')
            expect(events).toEqual([
                'environment',
                'initialization-started',
                'initialization-completed',
            ])
            expect(process.env.NODE_ENV).toBe('production')
            expect(process.exitCode ?? 0).toBe(0)
            expect(logError).not.toHaveBeenCalled()
        },
    )

    initializationTest(
        'wartet bis die Initialisierung vollständig abgeschlossen ist',
        0,
        async function () {
            const gate = Promise.withResolvers<void>()
            initializationGate = gate.promise
            let completed = false
            const importing =
                import('@/server/SystemBootstrap/initialize-production.ts').then(
                    () => {
                        completed = true
                        return completed
                    },
                )
            try {
                await waitForAssertion(() => {
                    expect(events).toContain('initialization-started')
                })
                expect(completed).toBe(false)
                expect(events).toEqual([
                    'environment',
                    'initialization-started',
                ])
                expect(logError).not.toHaveBeenCalled()
            } finally {
                gate.resolve()
                await importing
            }
            expect(completed).toBe(true)
            expect(events.at(-1)).toBe('initialization-completed')
            expect(process.exitCode ?? 0).toBe(0)
        },
    )

    initializationTest(
        'meldet ungültige Environment-Werte ausschließlich über den zentralen Logger und Exit 1',
        1,
        async function () {
            environmentError = new Error(
                'Synthetic environment failure: ' + databaseUrl,
            )
            await import('@/server/SystemBootstrap/initialize-production.ts')
            expect(events).toEqual(['environment'])
            expect(logError).toHaveBeenCalledWith(
                'database.initialization_failed',
                environmentError,
            )
            expect(logError).toHaveBeenCalledTimes(1)
            expect(process.exitCode).toBe(1)
        },
    )

    initializationTest(
        'meldet Initialisierungsfehler ausschließlich über den zentralen Logger und Exit 1',
        1,
        async function () {
            initializationError = new Error(
                'Synthetic initialization failure: ' + databaseUrl,
            )
            await import('@/server/SystemBootstrap/initialize-production.ts')
            expect(events).toEqual(['environment', 'initialization-started'])
            expect(logError).toHaveBeenCalledWith(
                'database.initialization_failed',
                initializationError,
            )
            expect(logError).toHaveBeenCalledTimes(1)
            expect(process.exitCode).toBe(1)
        },
    )
})
