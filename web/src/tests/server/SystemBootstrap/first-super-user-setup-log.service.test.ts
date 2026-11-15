import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const token = 'a'.repeat(43)
const renewedToken = 'b'.repeat(43)
const status = vi.fn(async function () {
    return { isRequired: true }
})
const createAccess = vi.fn(async function () {
    return token
})
const createMissingAccess = vi.fn(async function (): Promise<string | null> {
    return null
})
const clearAccess = vi.fn(async function () {})
const logError = vi.fn()
const monitors: Array<{ stop: () => void }> = []
let output = ''

vi.mock('@/server/SystemBootstrap/first-super-user.service.ts', () => ({
    getFirstSuperUserSetupStatusService: status,
}))
vi.mock(
    '@/server/SystemBootstrap/first-super-user-setup-access.service.ts',
    () => ({
        createFirstSuperUserSetupAccessService: createAccess,
        createFirstSuperUserSetupAccessIfMissingService: createMissingAccess,
        clearFirstSuperUserSetupAccessService: clearAccess,
    }),
)
vi.mock('@/server/Logging/logger.ts', () => ({ logError }))

import { startFirstSuperUserSetupLogService } from '@/server/SystemBootstrap/first-super-user-setup-log.service.ts'

async function start() {
    const monitor = await startFirstSuperUserSetupLogService(
        'https://app.example.test',
    )
    monitors.push(monitor)
    return monitor
}

beforeEach(function () {
    vi.useFakeTimers()
    status.mockReset().mockResolvedValue({ isRequired: true })
    createAccess.mockReset().mockResolvedValue(token)
    createMissingAccess.mockReset().mockResolvedValue(null)
    clearAccess.mockReset().mockResolvedValue(undefined)
    logError.mockClear()
    output = ''
    monitors.length = 0
    vi.spyOn(process.stdout, 'write').mockImplementation(function (chunk) {
        output += String(chunk)
        return true
    })
})

afterEach(function () {
    for (const monitor of monitors) monitor.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('automatischer First-Superuser-Link in den App-Logs', function () {
    it('does not start bootstrap work when startup was already aborted', async function () {
        const controller = new AbortController()
        controller.abort()
        await startFirstSuperUserSetupLogService('http://localhost:3000', controller.signal)
        expect(status).not.toHaveBeenCalled()
        expect(createAccess).not.toHaveBeenCalled()
        expect(output).toBe('')
    })

    it('suppresses a late initial link and renewal after shutdown during startup', async function () {
        const controller = new AbortController()
        const pending = Promise.withResolvers<string>()
        const accessStarted = Promise.withResolvers<void>()
        createAccess.mockImplementationOnce(function () {
            accessStarted.resolve()
            return pending.promise
        })
        const starting = startFirstSuperUserSetupLogService('http://localhost:3000', controller.signal)
        await accessStarted.promise
        controller.abort()
        pending.resolve(token)
        const monitor = await starting
        monitors.push(monitor)
        vi.advanceTimersByTime(600_000)
        expect(output).toBe('')
        expect(createMissingAccess).not.toHaveBeenCalled()
    })

    it('gibt beim Start einer leeren Installation eine vollständige kopierbare Fragment-URL aus', async function () {
        await start()

        expect(status).toHaveBeenCalledTimes(2)
        expect(createAccess).toHaveBeenCalledTimes(1)
        expect(output.split('\n')).toContain(
            'https://app.example.test/setup#access=' + token,
        )
        expect(output).toContain('10 Minuten gültig')
        expect(output).not.toContain('?access=')
        expect(logError).not.toHaveBeenCalled()
    })

    it('erzeugt bei vorhandenen Benutzern weder Zugang noch Logausgabe oder weitere Prüfungen', async function () {
        status.mockResolvedValue({ isRequired: false })
        await start()
        vi.advanceTimersByTime(600_000)

        expect(status).toHaveBeenCalledTimes(1)
        expect(createAccess).not.toHaveBeenCalled()
        expect(createMissingAccess).not.toHaveBeenCalled()
        expect(output).toBe('')
    })

    it('invalidiert bei regelmäßigen Prüfungen keinen noch gültigen Link', async function () {
        await start()
        const initialOutput = output
        vi.advanceTimersByTime(30_000)
        await waitForAssertion(() => {
            expect(createMissingAccess).toHaveBeenCalledTimes(1)
        })

        expect(createAccess).toHaveBeenCalledTimes(1)
        expect(output).toBe(initialOutput)
    })

    it('schreibt nach Ablauf oder Valkey-Verlust den neu erzeugten Link in die Logs', async function () {
        await start()
        createMissingAccess.mockResolvedValueOnce(renewedToken)
        vi.advanceTimersByTime(30_000)
        await waitForAssertion(() => {
            expect(output.split('\n')).toContain(
                'https://app.example.test/setup#access=' + renewedToken,
            )
        })

        expect(createAccess).toHaveBeenCalledTimes(1)
        expect(createMissingAccess).toHaveBeenCalledTimes(1)
    })

    it('beendet nach erfolgreicher Ersteinrichtung die regelmäßigen Prüfungen und Ausgaben', async function () {
        await start()
        const initialOutput = output
        status.mockResolvedValue({ isRequired: false })
        vi.advanceTimersByTime(30_000)
        await waitForAssertion(() => {
            expect(status).toHaveBeenCalledTimes(3)
        })
        vi.advanceTimersByTime(600_000)

        expect(status).toHaveBeenCalledTimes(3)
        expect(createMissingAccess).not.toHaveBeenCalled()
        expect(output).toBe(initialOutput)
    })

    it('räumt den Zugang auf, wenn die Ersteinrichtung während der Erzeugung abgeschlossen wird', async function () {
        status
            .mockResolvedValueOnce({ isRequired: true })
            .mockResolvedValueOnce({ isRequired: false })
        await start()
        vi.advanceTimersByTime(600_000)

        expect(createAccess).toHaveBeenCalledTimes(1)
        expect(clearAccess).toHaveBeenCalledTimes(1)
        expect(output).toBe('')
        expect(status).toHaveBeenCalledTimes(2)
    })

    it('meldet Ausfälle ohne Setup-URL und versucht die Erzeugung später erneut', async function () {
        const failure = new Error('Synthetic Valkey failure')
        createAccess.mockRejectedValueOnce(failure)
        await start()

        expect(output).toBe('')
        expect(logError).toHaveBeenCalledWith(
            'system.first-super-user.setup_link_failed',
            failure,
        )
        createMissingAccess.mockResolvedValueOnce(renewedToken)
        vi.advanceTimersByTime(30_000)
        await waitForAssertion(() => {
            expect(output).toContain('/setup#access=' + renewedToken)
        })
    })

    it('erzeugt bei einer fehlgeschlagenen Statusprüfung keinen Zugang', async function () {
        const failure = new Error('Synthetic database failure')
        status.mockRejectedValueOnce(failure)
        await start()

        expect(createAccess).not.toHaveBeenCalled()
        expect(output).toBe('')
        expect(logError).toHaveBeenCalledWith(
            'system.first-super-user.setup_link_failed',
            failure,
        )
    })

    it('beendet die Prüfungen beim Herunterfahren der App', async function () {
        const monitor = await start()
        monitor.stop()
        vi.advanceTimersByTime(600_000)

        expect(status).toHaveBeenCalledTimes(2)
        expect(createMissingAccess).not.toHaveBeenCalled()
    })

    it('gibt nach dem Herunterfahren keinen verspäteten Link aus', async function () {
        const monitor = await start()
        const initialOutput = output
        const pendingAccess = Promise.withResolvers<string | null>()
        createMissingAccess.mockReturnValueOnce(pendingAccess.promise)
        vi.advanceTimersByTime(30_000)
        await waitForAssertion(() => {
            expect(createMissingAccess).toHaveBeenCalledTimes(1)
        })
        monitor.stop()
        pendingAccess.resolve(renewedToken)
        await pendingAccess.promise

        expect(output).toBe(initialOutput)
        expect(status).toHaveBeenCalledTimes(3)
        vi.advanceTimersByTime(600_000)
        expect(status).toHaveBeenCalledTimes(3)
    })
})
