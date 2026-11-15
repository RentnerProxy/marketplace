import * as actualReact from 'react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { RESTORE_STATUS_QUERY_KEY } from '@/lib/Restore/restoreStatus.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const actualReactExports = { ...actualReact }
const effects: Array<actualReact.EffectCallback> = []
const cleanups: Array<() => void> = []
const queryClient = new QueryClient()
const refetch = vi.fn(async function () {})
const unsubscribe = vi.fn()
let onRealtimeEvent: ((event: RealtimeEvent) => void) | undefined
const browserWindow = new EventTarget()
const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
})

vi.mock('react', () => ({
    ...actualReactExports,
    useCallback: (callback: () => void) => callback,
    useEffect: (effect: actualReact.EffectCallback) => effects.push(effect),
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => queryClient,
    useQuery: () => ({
        data: undefined,
        isLoading: true,
        isError: false,
        refetch,
    }),
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents(callback: (event: RealtimeEvent) => void) {
        onRealtimeEvent = callback
        return unsubscribe
    },
}))

import useRestoreStatus from '@/shared/Restore/Hooks/useRestoreStatus.ts'

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
    queryClient.clear()
    restoreTestGlobals()
})

describe('gemeinsamer Restore-Status', function () {
    it('abonniert und aktualisiert nur Restore-Ereignisse und räumt Listener auf', function () {
        expect(useRestoreStatus().state).toEqual({
            restoreStatus: null,
            isLoading: true,
            isError: false,
        })
        for (const effect of effects) {
            const cleanup = effect()
            if (typeof cleanup === 'function') cleanups.push(cleanup)
        }

        onRealtimeEvent?.({
            type: 'connection.ready',
            payload: { connectedAt: '2026-10-01T10:00:00.000Z' },
        })
        expect(refetch).toHaveBeenCalledTimes(1)
        expect(
            queryClient.getQueryData(RESTORE_STATUS_QUERY_KEY),
        ).toBeUndefined()
        const payload = {
            version: 1,
            status: 'running',
            phase: 'restoring-database',
            percent: 70,
            processedBytes: 70,
            totalBytes: 100,
            startedAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:01:00.000Z',
        } as const
        onRealtimeEvent?.({ type: 'system-restore.changed', payload })
        expect(
            queryClient.getQueryData<typeof payload>(RESTORE_STATUS_QUERY_KEY),
        ).toEqual(payload)

        browserWindow.dispatchEvent(new Event('focus'))
        browserWindow.dispatchEvent(new Event('pageshow'))
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(4)
        browserDocument.visibilityState = 'hidden'
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(4)

        for (const cleanup of cleanups.splice(0)) cleanup()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        browserWindow.dispatchEvent(new Event('focus'))
        browserWindow.dispatchEvent(new Event('pageshow'))
        browserDocument.visibilityState = 'visible'
        browserDocument.dispatchEvent(new Event('visibilitychange'))
        expect(refetch).toHaveBeenCalledTimes(4)
    })
})
