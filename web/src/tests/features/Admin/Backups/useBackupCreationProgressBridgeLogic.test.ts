import * as actualReact from 'react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const actualReactExports = { ...actualReact }
const effects: Array<actualReact.EffectCallback> = []
const cleanups: Array<() => void> = []
const client = new QueryClient()
const refetch = vi.fn(async function () {})
const unsubscribe = vi.fn()
const invalidate = vi.spyOn(client, 'invalidateQueries')
let onRealtimeEvent: ((event: RealtimeEvent) => void) | undefined
const browserWindow = new EventTarget()
const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
})

vi.mock('react', () => ({
    ...actualReactExports,
    useCallback: (callback: () => void) => callback,
    useEffect: (effect: actualReact.EffectCallback) => effects.push(effect),
    useState: <Value>(value: Value) => [value, vi.fn()],
    useRef: <Value>(value: Value) => ({ current: value }),
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => client,
    useQuery: () => ({ data: null, refetch }),
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents(callback: (event: RealtimeEvent) => void) {
        onRealtimeEvent = callback
        return unsubscribe
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/features/Admin/Backups/middleware.ts', () => ({
    getBackupOverviewHandler: vi.fn(),
    getBackupCreationProgressHandler: vi.fn(),
}))
vi.mock(
    '@/features/Admin/Backups/Hooks/usePendingManualBackupIntent.ts',
    () => ({
        default: () => ({ state: { pendingManualBackupId: null } }),
        clearPendingManualBackupIntent: vi.fn(),
    }),
)
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    clearTransferTasks: vi.fn(),
    finishExternalTransferTask: vi.fn(),
    syncExternalTransferTask: vi.fn(),
}))

import useBackupCreationProgressBridgeLogic from '@/features/Admin/Backups/Hooks/useBackupCreationProgressBridgeLogic.ts'

beforeEach(function () {
    vi.clearAllMocks()
    effects.length = 0
    cleanups.length = 0
    onRealtimeEvent = undefined
    browserDocument.visibilityState = 'visible'
    stubTestGlobal('window', browserWindow)
    stubTestGlobal('document', browserDocument)
})

afterEach(function () {
    for (const cleanup of cleanups.splice(0)) cleanup()
    client.clear()
    restoreTestGlobals()
})

describe('Backup-Fortschritt über Realtime', function () {
    it('aktualisiert bei Backup-Änderung und Wiederverbindung und entfernt alle Listener', function () {
        useBackupCreationProgressBridgeLogic(
            '019f5b07-80e2-7000-8000-000000000001',
        )
        for (const effect of effects) {
            const cleanup = effect()
            if (typeof cleanup === 'function') cleanups.push(cleanup)
        }

        onRealtimeEvent?.({
            type: 'audit-log.created',
            payload: {
                auditLogId: '019f5b07-80e2-7000-8000-000000000002',
                createdAt: '2026-10-06T12:48:17.000Z',
            },
        })
        expect(refetch).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()

        onRealtimeEvent?.({
            type: 'admin-backups.changed',
            payload: { updatedAt: '2026-10-06T12:48:17.000Z' },
        })
        expect(refetch).toHaveBeenCalledTimes(1)
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-backups'] })
        onRealtimeEvent?.({
            type: 'connection.ready',
            payload: { connectedAt: '2026-10-06T12:49:17.000Z' },
        })
        expect(refetch).toHaveBeenCalledTimes(2)

        browserDocument.visibilityState = 'hidden'
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(2)
        browserDocument.visibilityState = 'visible'
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(3)

        for (const cleanup of cleanups.splice(0)) cleanup()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        browserWindow.dispatchEvent(new Event('focus'))
        browserWindow.dispatchEvent(new Event('pageshow'))
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(3)
    })
})
