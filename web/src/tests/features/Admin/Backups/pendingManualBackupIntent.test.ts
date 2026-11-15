import { afterEach, describe, expect, it, vi, setSystemTime } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import usePendingManualBackupIntent, {
    clearPendingManualBackupIntent,
    getPendingManualBackupIntent,
    setPendingManualBackupIntent,
} from '@/features/Admin/Backups/Hooks/usePendingManualBackupIntent.ts'

vi.mock('react', function () {
    return {
        useEffect: function (effect: () => void | (() => void)) {
            effect()
        },
        useSyncExternalStore: function (
            _subscribe: (listener: () => void) => () => void,
            getSnapshot: () => unknown,
        ) {
            return getSnapshot()
        },
    }
})

const runId = '019f5b07-80e2-7000-8000-000000000001'
const userId = '019f5b07-80e2-7000-8000-000000000002'

function createWindowMock() {
    const storage = new Map<string, string>()

    return {
        clearTimeout,
        setTimeout,
        sessionStorage: {
            getItem: vi.fn((key: string) => storage.get(key) ?? null),
            removeItem: vi.fn((key: string) => storage.delete(key)),
            setItem: vi.fn((key: string, value: string) => {
                storage.set(key, value)
            }),
        },
    }
}

describe('Pending-Manual-Backup-Intent', function () {
    afterEach(function () {
        clearPendingManualBackupIntent()
        vi.useRealTimers()
        restoreTestGlobals()
    })

    it('persistiert nur validierte, benutzergebundene Run-IDs und löscht sie vergleichssicher', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        stubTestGlobal('window', createWindowMock())

        expect(setPendingManualBackupIntent({ runId, userId })).toBe(true)
        expect(getPendingManualBackupIntent()).toEqual({
            runId,
            userId,
            queuedAt: Date.now(),
        })

        expect(
            setPendingManualBackupIntent({
                runId: 'e66be994-01ca-4d6b-b89d-03f4f69cefc6',
                userId,
            }),
        ).toBe(false)
        clearPendingManualBackupIntent(
            '019f5b07-80e2-7000-8000-000000000003',
            userId,
        )
        expect(getPendingManualBackupIntent()?.runId).toBe(runId)

        clearPendingManualBackupIntent(runId, userId)
        expect(getPendingManualBackupIntent()).toBeNull()
    })

    it('verwirft den gecachten Intent auch in einem bereits geöffneten Tab nach 24 Stunden', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        stubTestGlobal('window', createWindowMock())

        expect(setPendingManualBackupIntent({ runId, userId })).toBe(true)
        vi.advanceTimersByTime(24 * 60 * 60_000 + 1)

        expect(getPendingManualBackupIntent()).toBeNull()
    })

    it('behält den Intent, bis die Benutzeridentität nach einem Reload aufgelöst ist', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        stubTestGlobal('window', createWindowMock())
        expect(setPendingManualBackupIntent({ runId, userId })).toBe(true)

        expect(
            usePendingManualBackupIntent(null).state.pendingManualBackupId,
        ).toBeNull()
        expect(getPendingManualBackupIntent()?.runId).toBe(runId)
        expect(
            usePendingManualBackupIntent(userId).state.pendingManualBackupId,
        ).toBe(runId)
    })

    it('meldet Storage-Fehler und hält den laufenden Tab im Speicher synchron', function () {
        const windowMock = createWindowMock()
        const storageError = new Error('Session Storage ist gesperrt')
        windowMock.sessionStorage.setItem.mockImplementation(function () {
            throw storageError
        })
        stubTestGlobal('window', windowMock)
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(function () {})

        try {
            expect(setPendingManualBackupIntent({ runId, userId })).toBe(true)
            expect(getPendingManualBackupIntent()?.runId).toBe(runId)
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining('Session Storage gespeichert'),
                storageError,
            )
        } finally {
            consoleError.mockRestore()
        }
    })
})
