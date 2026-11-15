import { REJECTED_AUTHENTICATION_LIMITS } from '@/config/security.config.ts'
import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    REJECTED_AUTHENTICATION_FLOWS,
    REJECTED_AUTHENTICATION_REASONS,
} from '@/lib/Auth/rejectedAuthentication.ts'
import { sanitizeLogContextService } from '@/server/Logging/log-context.ts'
import type { LogContext } from '@/server/Logging/Types/logging.types.ts'

const logWarn = vi.fn((_event: string, _context?: LogContext) => undefined)
vi.mock('@/server/Logging/logger.ts', () => ({ logWarn }))

const clock = { now: 500, throws: false }
const timerFailure = {
    mode: 'none' as
        'none' | 'create' | 'empty_timer' | 'missing_unref' | 'unref',
    clearThrows: false,
}
const timers = new Map<
    ReturnType<typeof setTimeout>,
    { callback: () => void; due: number; unrefCalls: number }
>()
const originalMaximum = REJECTED_AUTHENTICATION_LIMITS.maximumCount
const originalSetTimeout = globalThis.setTimeout
const outputFields = [
    'writableNeedDrain',
    'destroyed',
    'writableEnded',
] as const
const outputDescriptors = new Map(
    outputFields.map((field) => [
        field,
        Object.getOwnPropertyDescriptor(process.stdout, field),
    ]),
)
let record: typeof import('@/server/Auth/rejected-authentication.service.ts').recordRejectedAuthenticationService
let setTimerSpy: Mock<
    (callback: () => void, delay?: number) => ReturnType<typeof setTimeout>
>
let clearTimerSpy: ReturnType<typeof vi.spyOn>

function outputFlag(
    field: (typeof outputFields)[number],
    value: boolean,
): void {
    Object.defineProperty(process.stdout, field, {
        configurable: true,
        value,
    })
}

function fireDue(): void {
    const due = [...timers.entries()].filter(
        ([, timer]) => timer.due <= clock.now,
    )
    for (const [handle, timer] of due) {
        timers.delete(handle)
        timer.callback()
    }
}

function advance(milliseconds: number): void {
    clock.now += milliseconds
    fireDue()
}

function counts(): Array<number | undefined> {
    return logWarn.mock.calls.map(([, context]) =>
        typeof context?.count === 'number' ? context.count : undefined,
    )
}

beforeEach(async () => {
    clock.now = 500
    clock.throws = false
    timerFailure.mode = 'none'
    timerFailure.clearThrows = false
    timers.clear()
    Reflect.set(REJECTED_AUTHENTICATION_LIMITS, 'maximumCount', originalMaximum)
    logWarn.mockReset()
    logWarn.mockImplementation(() => undefined)
    for (const field of outputFields) outputFlag(field, false)

    vi.spyOn(performance, 'now').mockImplementation(() => {
        if (clock.throws) throw new Error('synthetic clock failure')
        return clock.now
    })
    setTimerSpy = vi.fn((callback: () => void, delay?: number) => {
        if (timerFailure.mode === 'create') {
            throw new Error('synthetic timer failure')
        }
        if (timerFailure.mode === 'empty_timer') {
            return undefined as unknown as ReturnType<typeof setTimeout>
        }
        const entry = {
            callback: () => Reflect.apply(callback, undefined, []),
            due: clock.now + (delay ?? 0),
            unrefCalls: 0,
        }
        const timer = {
            unref: () => {
                entry.unrefCalls += 1
                if (timerFailure.mode === 'unref') {
                    throw new Error('synthetic unref failure')
                }
            },
        }
        if (timerFailure.mode === 'missing_unref') {
            Reflect.set(timer, 'unref', undefined)
        }

        const handle = timer as unknown as ReturnType<typeof setTimeout>
        timers.set(handle, entry)
        return handle
    })
    Reflect.set(globalThis, 'setTimeout', setTimerSpy)
    clearTimerSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation((handle) => {
            if (timerFailure.clearThrows) {
                throw new Error('synthetic clear failure')
            }
            for (const savedHandle of timers.keys()) {
                if (savedHandle === handle) timers.delete(savedHandle)
            }
        })

    const module =
        await import('@/server/Auth/rejected-authentication.service.ts')
    record = module.recordRejectedAuthenticationService
})

afterEach(() => {
    clock.throws = false
    clock.now = 500 + REJECTED_AUTHENTICATION_LIMITS.windowMs * 50
    timerFailure.mode = 'none'
    timerFailure.clearThrows = false
    logWarn.mockImplementation(() => undefined)
    for (const field of outputFields) outputFlag(field, false)

    for (const flow of REJECTED_AUTHENTICATION_FLOWS) {
        for (const reason of REJECTED_AUTHENTICATION_REASONS)
            record(flow, reason)
    }
    advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
    timers.clear()
    Reflect.set(globalThis, 'setTimeout', originalSetTimeout)
    Reflect.set(REJECTED_AUTHENTICATION_LIMITS, 'maximumCount', originalMaximum)
    vi.restoreAllMocks()
    for (const [field, descriptor] of outputDescriptors) {
        if (descriptor) {
            Object.defineProperty(process.stdout, field, descriptor)
        } else {
            Reflect.deleteProperty(process.stdout, field)
        }
    }
})

describe('recordRejectedAuthenticationService', () => {
    it('schreibt den ersten Versuch sofort und nur weitere Versuche als Summary', () => {
        record('password_login', 'invalid_credentials')
        expect(logWarn).toHaveBeenCalledWith('auth.authentication.rejected', {
            authenticationFlow: 'password_login',
            authenticationReason: 'invalid_credentials',
            count: 1,
        })
        expect(logWarn).toHaveBeenCalledTimes(1)
        expect(timers.size).toBe(1)
        expect([...timers.values()][0]?.unrefCalls).toBe(1)
        record('password_login', 'invalid_credentials')
        record('password_login', 'invalid_credentials')
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs - 1)
        expect(counts()).toEqual([1])
        advance(1)
        expect(counts()).toEqual([1, 2])
        expect(timers.size).toBe(0)
    })

    it('begrenzt 100000 Versuche auf einen Timer und zwei Logzeilen ohne Zählverlust', () => {
        const listeners = process.stdout.listenerCount('drain')
        for (let attempt = 0; attempt < 100_000; attempt += 1) {
            record('password_login', 'invalid_two_factor')
        }
        expect(setTimerSpy).toHaveBeenCalledTimes(1)
        expect(timers.size).toBe(1)
        expect(counts()).toEqual([1])
        expect(process.stdout.listenerCount('drain')).toBe(listeners)
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1, 99_999])
        expect(
            counts().reduce<number>((sum, count) => sum + (count ?? 0), 0),
        ).toBe(100_000)
    })

    it('hält alle 39 festen Flow-/Reason-Paare getrennt und begrenzt', () => {
        for (const flow of REJECTED_AUTHENTICATION_FLOWS) {
            for (const reason of REJECTED_AUTHENTICATION_REASONS) {
                record(flow, reason)
                record(flow, reason)
            }
        }
        expect(timers.size).toBe(39)
        expect(setTimerSpy).toHaveBeenCalledTimes(39)
        expect(logWarn).toHaveBeenCalledTimes(39)
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(timers.size).toBe(0)
        expect(logWarn).toHaveBeenCalledTimes(78)
        for (const flow of REJECTED_AUTHENTICATION_FLOWS) {
            for (const reason of REJECTED_AUTHENTICATION_REASONS) {
                const matching = logWarn.mock.calls.filter(
                    ([, context]) =>
                        context?.authenticationFlow === flow &&
                        context.authenticationReason === reason,
                )
                expect(matching.map(([, context]) => context?.count)).toEqual([
                    1, 1,
                ])
            }
        }
    })

    it('schreibt keine leere Summary und hält keinen Idle-Timer', () => {
        record('reauthentication', 'stale_proof')
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs * 10)
        expect(counts()).toEqual([1])
        expect(timers.size).toBe(0)
        expect(setTimerSpy).toHaveBeenCalledTimes(1)
        record('reauthentication', 'stale_proof')
        expect(counts()).toEqual([1, 1])
    })

    it('sättigt zusätzliche Zähler ohne Überlauf', () => {
        expect(
            Reflect.set(REJECTED_AUTHENTICATION_LIMITS, 'maximumCount', 3),
        ).toBe(true)
        for (let attempt = 0; attempt < 20; attempt += 1) {
            record('passkey_login', 'invalid_passkey')
        }
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1, 3])
        expect(
            logWarn.mock.calls.every(([, context]) =>
                Number.isSafeInteger(context?.count),
            ),
        ).toBe(true)
    })

    it('ordnet den Versuch an der exakten Grenze dem neuen Fenster zu', () => {
        record('password_login', 'account_locked')
        record('password_login', 'account_locked')
        clock.now += REJECTED_AUTHENTICATION_LIMITS.windowMs
        record('password_login', 'account_locked')
        expect(counts()).toEqual([1, 1, 1])
        expect(timers.size).toBe(1)
        fireDue()
        expect(counts()).toEqual([1, 1, 1])
        expect(timers.size).toBe(1)
        record('password_login', 'account_locked')
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1, 1, 1, 1])
    })

    it('verwendet einen verspäteten Timer weiter und zählt keine alten Versuche doppelt', () => {
        record('passkey_login', 'rate_limited')
        record('passkey_login', 'rate_limited')
        clock.now += REJECTED_AUTHENTICATION_LIMITS.windowMs + 250
        record('passkey_login', 'rate_limited')
        record('passkey_login', 'rate_limited')
        record('passkey_login', 'rate_limited')
        expect(counts()).toEqual([1, 1, 1])
        expect(setTimerSpy).toHaveBeenCalledTimes(1)
        expect(clearTimerSpy).not.toHaveBeenCalled()
        clock.now += 125
        fireDue()
        expect(timers.size).toBe(1)
        expect(setTimerSpy).toHaveBeenCalledTimes(2)
        expect(setTimerSpy.mock.calls[1]?.[1]).toBe(
            REJECTED_AUTHENTICATION_LIMITS.windowMs - 125,
        )
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs - 125)
        expect(counts()).toEqual([1, 1, 1, 2])
    })

    it('schließt ein Fenster bei einem zu früh ausgeführten Timer nicht vorzeitig', () => {
        record('reauthentication', 'invalid_session')
        record('reauthentication', 'invalid_session')
        const first = [...timers.entries()][0]
        expect(first).toBeDefined()
        if (!first) throw new Error('Expected a timer')
        timers.delete(first[0])
        clock.now += 10
        first[1].callback()
        expect(counts()).toEqual([1])
        expect(timers.size).toBe(1)
        expect(setTimerSpy.mock.calls[1]?.[1]).toBe(
            REJECTED_AUTHENTICATION_LIMITS.windowMs - 10,
        )
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs - 10)
        first[1].callback()
        expect(counts()).toEqual([1, 1])
        expect(timers.size).toBe(0)
    })

    it('ignoriert Wanduhrsprünge bei der Fensterentscheidung', () => {
        record('password_login', 'attempts_busy')
        vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER)
        record('password_login', 'attempts_busy')
        expect(counts()).toEqual([1])
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1, 1])
    })

    it.each([
        undefined,
        null,
        false,
        0,
        1n,
        Symbol('private-token'),
        '',
        '__proto__',
        'constructor',
        'toString',
        'PASSWORD_LOGIN',
        'password_login\n',
        'password_login ',
        'person@example.test',
        '192.0.2.1',
        'raw-session-token',
        'x'.repeat(100_000),
        new String('password_login'),
    ])(
        'verwirft einen unbekannten primitiven oder boxed Wert ohne Statezugriff',
        (value) => {
            for (let attempt = 0; attempt < 5; attempt += 1) {
                Reflect.apply(record, undefined, [value, 'invalid_credentials'])
                Reflect.apply(record, undefined, ['password_login', value])
            }
            expect(logWarn).not.toHaveBeenCalled()
            expect(setTimerSpy).not.toHaveBeenCalled()
            expect(performance.now).not.toHaveBeenCalled()
        },
    )

    it('liest weder persönliche Objekte noch Getter, Proxyfallen oder Fehlertexte', () => {
        const read = vi.fn(() => {
            throw new Error('private@example.test password-hash secret')
        })
        const payload = Object.defineProperties(
            {},
            {
                toString: { get: read },
                flow: { get: read },
                reason: { get: read },
                message: { get: read },
            },
        )
        const proxy = new Proxy({}, { get: read, ownKeys: read })
        const revoked = Proxy.revocable({}, {})
        revoked.revoke()
        for (const value of [
            payload,
            proxy,
            revoked.proxy,
            new Error('private-token'),
        ]) {
            expect(() =>
                Reflect.apply(record, undefined, [value, value]),
            ).not.toThrow()
        }
        expect(read).not.toHaveBeenCalled()
        expect(logWarn).not.toHaveBeenCalled()
        expect(setTimerSpy).not.toHaveBeenCalled()
    })

    it('erlaubt ausschließlich die festen Auth-Strings im zentralen Logger-Filter', () => {
        expect(
            sanitizeLogContextService({
                authenticationFlow: 'password_login',
                authenticationReason: 'invalid_credentials',
                count: 1,
            }),
        ).toEqual({
            authenticationFlow: 'password_login',
            authenticationReason: 'invalid_credentials',
            count: 1,
        })
        for (const value of [
            'private@example.test',
            'password_login\n',
            '__proto__',
        ]) {
            expect(
                sanitizeLogContextService({
                    authenticationFlow: value,
                    authenticationReason: value,
                    password: 'raw-password',
                    ip: '192.0.2.1',
                }),
            ).toEqual({})
        }
        record('reauthentication', 'credential_method_mismatch')
        expect(
            Object.keys(logWarn.mock.calls[0]?.[1] ?? {}).toSorted(),
        ).toEqual(
            ['authenticationFlow', 'authenticationReason', 'count'].toSorted(),
        )
    })

    it.each([...outputFields])(
        'verwirft Writes bei %s ohne Rückstau, Listener oder Burst-Reset',
        (field) => {
            const listeners = process.stdout.listenerCount('drain')
            outputFlag(field, true)
            for (let attempt = 0; attempt < 100_000; attempt += 1) {
                record('reauthentication', 'stale_credentials')
            }
            expect(logWarn).not.toHaveBeenCalled()
            expect(timers.size).toBe(1)
            expect(process.stdout.listenerCount('drain')).toBe(listeners)
            outputFlag(field, false)
            record('reauthentication', 'stale_credentials')
            expect(logWarn).not.toHaveBeenCalled()
            advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
            expect(counts()).toEqual([100_000])
        },
    )

    it('verwirft auch eine Summary während Backpressure statt einen Payload zu behalten', () => {
        record('password_login', 'inactive_account')
        record('password_login', 'inactive_account')
        outputFlag('writableNeedDrain', true)
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1])
        expect(timers.size).toBe(0)
        outputFlag('writableNeedDrain', false)
        record('password_login', 'inactive_account')
        expect(counts()).toEqual([1, 1])
    })

    it('behält ein Fenster nach synchronem Loggerfehler und schließt es nach Summaryfehler', () => {
        logWarn.mockImplementation(() => {
            throw new Error('synthetic logger failure')
        })
        expect(() => {
            for (let attempt = 0; attempt < 100_000; attempt += 1) {
                record('password_login', 'account_lock_created')
            }
        }).not.toThrow()
        expect(counts()).toEqual([1])
        expect(timers.size).toBe(1)
        expect(() =>
            advance(REJECTED_AUTHENTICATION_LIMITS.windowMs),
        ).not.toThrow()
        expect(counts()).toEqual([1, 99_999])
        expect(timers.size).toBe(0)
        logWarn.mockImplementation(() => undefined)
        record('password_login', 'account_lock_created')
        expect(counts()).toEqual([1, 99_999, 1])
    })

    it('setzt Zustand und Timer vor einem reentranten Loggeraufruf', () => {
        logWarn.mockImplementationOnce(() => {
            record('passkey_login', 'invalid_challenge')
        })
        record('passkey_login', 'invalid_challenge')
        expect(counts()).toEqual([1])
        expect(timers.size).toBe(1)
        advance(REJECTED_AUTHENTICATION_LIMITS.windowMs)
        expect(counts()).toEqual([1, 1])
    })

    it.each(['create', 'empty_timer', 'missing_unref', 'unref'] as const)(
        'begrenzt weitere Versuche auch nach Timerfehler %s',
        (mode) => {
            timerFailure.mode = mode
            for (let attempt = 0; attempt < 100_000; attempt += 1) {
                record('passkey_login', 'invalid_challenge')
            }
            expect(counts()).toEqual([1])
            expect(setTimerSpy).toHaveBeenCalledTimes(1)
            expect(timers.size).toBe(0)
            timerFailure.mode = 'none'
            clock.now += REJECTED_AUTHENTICATION_LIMITS.windowMs
            record('passkey_login', 'invalid_challenge')
            expect(counts()).toEqual([1, 99_999, 1])
            expect(timers.size).toBe(1)
        },
    )

    it('erzeugt bei fehlgeschlagenem unref und clear keinen zweiten aktiven Timer', () => {
        timerFailure.mode = 'unref'
        timerFailure.clearThrows = true
        record('password_login', 'rate_limited')
        record('password_login', 'rate_limited')
        expect(timers.size).toBe(1)
        expect(clearTimerSpy).toHaveBeenCalledTimes(1)
        clock.now += REJECTED_AUTHENTICATION_LIMITS.windowMs
        record('password_login', 'rate_limited')
        expect(setTimerSpy).toHaveBeenCalledTimes(1)
        expect(timers.size).toBe(1)
        timerFailure.mode = 'none'
        timerFailure.clearThrows = false
        fireDue()
        expect(setTimerSpy).toHaveBeenCalledTimes(2)
        expect(timers.size).toBe(1)
        expect(counts()).toEqual([1, 1, 1])
    })

    it.each([NaN, Infinity, -1, Number.MAX_VALUE])(
        'bleibt bei ungültiger monotoner Uhr %s ohne neue Zustände oder Writes',
        (value) => {
            clock.now = value
            expect(() =>
                record('password_login', 'invalid_credentials'),
            ).not.toThrow()
            expect(logWarn).not.toHaveBeenCalled()
            expect(setTimerSpy).not.toHaveBeenCalled()
        },
    )

    it('ignoriert synchrone Uhrenfehler auch im Timer und setzt kein Burst-Fenster zurück', () => {
        record('password_login', 'invalid_credentials')
        record('password_login', 'invalid_credentials')
        clock.throws = true
        expect(() =>
            record('password_login', 'invalid_credentials'),
        ).not.toThrow()
        expect(() =>
            advance(REJECTED_AUTHENTICATION_LIMITS.windowMs),
        ).not.toThrow()
        expect(counts()).toEqual([1])
        clock.throws = false
        record('password_login', 'invalid_credentials')
        expect(counts()).toEqual([1, 1, 1])
    })
})
