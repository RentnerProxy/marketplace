import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'
import {
    isRestoreAccessBlocked,
    parseRestoreStatus,
    restoreStatusQueryOptions,
    RESTORE_STATUS_QUERY_KEY,
} from '@/lib/Restore/restoreStatus.ts'

const timestamp = '2026-08-11T12:00:00.000Z'

describe('Restore-Status-Parser', function () {
    it('pollt nur bei einem aktiven Restore und stoppt nach jedem terminalen Zustand', function () {
        const queryClient = new QueryClient()
        const options = restoreStatusQueryOptions()
        const query = queryClient
            .getQueryCache()
            .build<
                RestoreStatus,
                Error,
                RestoreStatus,
                typeof RESTORE_STATUS_QUERY_KEY
            >(queryClient, options)
        const interval = options.refetchInterval
        if (typeof interval !== 'function')
            throw new Error('Missing interval policy')

        expect(interval(query)).toBe(false)
        query.setData(
            parseRestoreStatus({
                version: 1,
                status: 'idle',
                phase: null,
                percent: null,
                processedBytes: 0,
                totalBytes: 0,
                startedAt: null,
                updatedAt: null,
            }),
        )
        expect(interval(query)).toBe(false)
        for (const status of [
            'running',
            'recovery-required',
            'completed',
            'failed',
        ] as const) {
            query.setData(
                parseRestoreStatus({
                    version: 1,
                    status,
                    phase: 'finalizing',
                    percent: 100,
                    processedBytes: 100,
                    totalBytes: 100,
                    startedAt: timestamp,
                    updatedAt: timestamp,
                }),
            )
            expect(interval(query)).toBe(
                status === 'running' || status === 'recovery-required'
                    ? 2000
                    : false,
            )
        }
        expect(options.refetchIntervalInBackground).toBe(false)
        queryClient.clear()
    })

    it('akzeptiert Idle und einen konsistenten laufenden Fortschritt', function () {
        expect(
            parseRestoreStatus({
                version: 1,
                status: 'idle',
                phase: null,
                percent: null,
                processedBytes: 0,
                totalBytes: 0,
                startedAt: null,
                updatedAt: null,
            }),
        ).toMatchObject({ status: 'idle', phase: null })

        expect(
            parseRestoreStatus({
                version: 1,
                status: 'running',
                phase: 'restoring-database',
                percent: 64,
                processedBytes: 640,
                totalBytes: 1_000,
                startedAt: timestamp,
                updatedAt: timestamp,
            }),
        ).toMatchObject({
            status: 'running',
            phase: 'restoring-database',
            percent: 64,
        })

        expect(
            parseRestoreStatus({
                version: 1,
                status: 'recovery-required',
                phase: 'rolling-back',
                percent: null,
                processedBytes: 640,
                totalBytes: 1_000,
                startedAt: timestamp,
                updatedAt: timestamp,
            }),
        ).toMatchObject({
            status: 'recovery-required',
            phase: 'rolling-back',
        })
        expect(isRestoreAccessBlocked('running')).toBe(true)
        expect(isRestoreAccessBlocked('recovery-required')).toBe(true)
        expect(isRestoreAccessBlocked('failed')).toBe(false)
    })

    it('lehnt unbekannte Felder, inkonsistente Phasen und unmögliche Bytewerte ab', function () {
        expect(() =>
            parseRestoreStatus({
                version: 1,
                status: 'idle',
                phase: 'preparing',
                percent: null,
                processedBytes: 0,
                totalBytes: 0,
                startedAt: null,
                updatedAt: null,
            }),
        ).toThrow()

        expect(() =>
            parseRestoreStatus({
                version: 1,
                status: 'running',
                phase: 'validating',
                percent: 101,
                processedBytes: 2,
                totalBytes: 1,
                startedAt: timestamp,
                updatedAt: timestamp,
                internalError: 'nicht öffentlich',
            }),
        ).toThrow()
    })
})
