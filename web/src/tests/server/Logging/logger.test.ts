import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    setSystemTime,
} from 'bun:test'
import {
    logError,
    logInfo,
    logWarn,
    logWarnError,
} from '@/server/Logging/logger.ts'

function readEntry(spy: ReturnType<typeof vi.spyOn>) {
    return JSON.parse(String(spy.mock.calls.at(-1)?.[0])) as Record<
        string,
        unknown
    >
}

describe('strukturierter Logger', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>
    let stderrSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-04-05T06:07:08.000Z'))
        stdoutSpy = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => true)
        stderrSpy = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation(() => true)
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('schreibt Info und Warnungen als einzelne JSON-Zeilen', () => {
        logInfo('app.started', { port: 3000 })
        logWarn('app.degraded', { valkey: false })
        expect(readEntry(stdoutSpy)).toEqual({
            timestamp: '2026-04-05T06:07:08.000Z',
            level: 'warn',
            event: 'app.degraded',
            valkey: false,
        })
        expect(stdoutSpy).toHaveBeenCalledTimes(2)
        expect(stderrSpy).not.toHaveBeenCalled()
        expect(String(stdoutSpy.mock.calls[0]?.[0]).split('\n')).toHaveLength(2)
    })

    it('markiert bereinigte WebSocket-Ereignisse für die eigene Prozesskonsole', () => {
        logInfo('realtime.server_started', {
            port: 3001,
            password: 'synthetic-secret',
        })
        expect(readEntry(stdoutSpy)).toMatchObject({
            service: 'websocket',
            event: 'realtime.server_started',
            port: 3001,
        })
        expect(String(stdoutSpy.mock.calls.at(-1)?.[0])).not.toContain(
            'synthetic-secret',
        )
    })

    it.each(['development', 'production'])(
        'verwirft SQL, Parameter, SMTP-Inhalte und Stacks in %s',
        (environment) => {
            const previous = process.env.NODE_ENV
            process.env.NODE_ENV = environment
            try {
                const cause = Object.assign(
                    new Error(
                        'recipient@example.test raw-reset-token TOTP-SEED',
                    ),
                    {
                        code: '23505',
                        response: '550 recipient@example.test rejected',
                    },
                )
                const error = Object.assign(
                    new Error(
                        'insert into users values (password-hash, recipient@example.test)',
                        { cause },
                    ),
                    {
                        code: 'EAUTH',
                        responseCode: 535,
                        query: 'select secrets',
                        params: ['password-hash'],
                    },
                )
                error.stack = 'private-path SMTP-PASSWORD'
                logError('db.failed', error, {
                    operation: 'insert',
                    email: 'recipient@example.test',
                    error: error.message,
                })
                const entry = readEntry(stderrSpy)
                expect(entry).toMatchObject({
                    level: 'error',
                    event: 'db.failed',
                    operation: 'insert',
                    errorName: 'Error',
                    errorCode: 'EAUTH',
                    smtpStatus: 535,
                    errorCauses: [{ errorName: 'Error', errorCode: '23505' }],
                })
                expect(entry.errorId).toMatch(/^[0-9a-f-]{36}$/)
                expect(Object.keys(entry).toSorted()).toEqual(
                    [
                        'errorCauses',
                        'errorCode',
                        'errorId',
                        'errorName',
                        'event',
                        'level',
                        'operation',
                        'smtpStatus',
                        'timestamp',
                    ].toSorted(),
                )
            } finally {
                process.env.NODE_ENV = previous
            }
        },
    )

    it('protokolliert Initialisierungsmodus und Rechtezahlen ohne freie Inhalte', () => {
        logInfo('database.initialization_completed', {
            mode: 'production',
            syncedPermissions: 12,
            grantedAssignments: 3,
            databaseUrl: 'postgresql://synthetic-secret@db.invalid/app_test',
        })
        expect(readEntry(stdoutSpy)).toMatchObject({
            mode: 'production',
            syncedPermissions: 12,
            grantedAssignments: 3,
        })
        expect(readEntry(stdoutSpy)).not.toHaveProperty('databaseUrl')
        logInfo('database.initialization_started', { mode: 'synthetic-secret' })
        expect(readEntry(stdoutSpy)).not.toHaveProperty('mode')
    })

    it('behält sichere Korrelation und Metriken, verwirft beliebige Metadaten und reservierte Felder', () => {
        logInfo('backup.finished', {
            runId: 'ABCDEFFF-0000-4000-8000-000000000001',
            userId: 'user@example.test',
            jobId: '42',
            jobName: 'manual-backup',
            queueName: 'backups',
            phase: 'verifying',
            durationMs: 10,
            count: Infinity,
            command: 'pg_dump --password=secret',
            fileName: 'private.tar',
            timestamp: 'secret',
            event: 'secret',
            level: 'secret',
        })
        expect(readEntry(stdoutSpy)).toEqual({
            timestamp: '2026-04-05T06:07:08.000Z',
            level: 'info',
            event: 'backup.finished',
            runId: 'abcdefff-0000-4000-8000-000000000001',
            jobId: '42',
            jobName: 'manual-backup',
            queueName: 'backups',
            phase: 'verifying',
            durationMs: 10,
        })
    })

    it('schreibt Warnfehler mit sicherer Fehlerklasse auf stdout', () => {
        logWarnError(
            'auth.alert.failed',
            Object.assign(new TypeError('secret'), { code: 'ECONNREFUSED' }),
        )
        expect(readEntry(stdoutSpy)).toMatchObject({
            level: 'warn',
            errorName: 'TypeError',
            errorCode: 'ECONNREFUSED',
        })
        expect(stderrSpy).not.toHaveBeenCalled()
    })

    it.each([
        'RestoreInProgressError',
        'StorageMutationAdmissionBusyError',
        'StorageMutationFenceUnavailableError',
        'StorageMutationBarrierUnavailableError',
    ])('erhält die sichere Storage-Fehlerklasse %s ohne Rohdaten', (name) => {
        const error = Object.assign(new Error('private-path secret'), { name })
        logError('backup.worker.deferred_start_failed', error)

        expect(readEntry(stderrSpy)).toMatchObject({ errorName: name })
        expect(readEntry(stderrSpy)).not.toHaveProperty('message')
        expect(readEntry(stderrSpy)).not.toHaveProperty('stack')
        expect(String(stderrSpy.mock.calls.at(-1)?.[0])).not.toContain('secret')
    })

    it('wertet weder Fehlertexte noch Context-Getter aus', () => {
        const getter = vi.fn(() => {
            throw new Error('must not execute')
        })
        const context = Object.defineProperty({}, 'userId', { get: getter })
        const error = Object.defineProperties(
            {},
            {
                name: { get: getter },
                message: { get: getter },
                stack: { get: getter },
                code: { get: getter },
                cause: { get: getter },
                toString: { value: getter },
            },
        )
        logError('auth.failed', error, context)
        expect(getter).not.toHaveBeenCalled()
        expect(readEntry(stderrSpy).errorName).toBe('UnknownError')
    })

    it.each(['private@example.test', 'reset.token=secret', 'x'.repeat(121)])(
        'verwirft ungültigen Ereignisnamen %s',
        (event) => {
            logWarn(event, {
                jobId: 'raw-token',
                jobName: 'private@example.test',
            })
            expect(readEntry(stdoutSpy)).toEqual({
                timestamp: '2026-04-05T06:07:08.000Z',
                level: 'warn',
                event: 'logging.invalid_event',
            })
        },
    )

    it('protokolliert auch ein nicht lesbares Aggregate ohne zweite Ausnahme', () => {
        const { proxy, revoke } = Proxy.revocable([], {})
        revoke()
        expect(() => logError('backup.failed', { errors: proxy })).not.toThrow()
        expect(readEntry(stderrSpy)).toMatchObject({
            event: 'backup.failed',
            errorName: 'UnknownError',
        })
        expect(readEntry(stderrSpy)).not.toHaveProperty('aggregateErrors')
    })

    it('serialisiert primitive und zyklische Fehler ohne Geheimtext', () => {
        const error = new Error('secret')
        error.cause = error
        logError('auth.failed', error)
        expect(readEntry(stderrSpy)).not.toHaveProperty('errorCauses')
        logError('auth.failed', 'private-token')
        expect(readEntry(stderrSpy)).toMatchObject({
            errorName: 'UnknownError',
        })
        expect(String(stderrSpy.mock.calls.at(-1)?.[0])).not.toContain(
            'private-token',
        )
    })
})
