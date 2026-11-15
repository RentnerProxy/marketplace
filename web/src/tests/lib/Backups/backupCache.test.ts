import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { BackupRunCreationProgress } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import type { getBackupOverviewHandler } from '@/features/Admin/Backups/middleware.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

const mocks = {
    runs: [] as Array<{ status: string }>,
    progress: null as BackupRunCreationProgress | null,
    getProgress: vi.fn(),
}
vi.mock('@/features/Admin/Backups/middleware.ts', function () {
    return {
        getBackupOverviewHandler: async function () {
            return { runs: mocks.runs }
        },
        getBackupCreationProgressHandler: mocks.getProgress,
    }
})

import {
    backupOverviewQueryOptions,
    backupCreationProgressQueryOptions,
    ADMIN_BACKUPS_QUERY_KEY,
} from '@/lib/Backups/backupCache.ts'

beforeEach(function () {
    vi.clearAllMocks()
    mocks.runs = []
    mocks.progress = null
    mocks.getProgress.mockImplementation(async () => mocks.progress)
})

describe('Backup-Abfragen ohne Leerlauf-Polling', function () {
    it('aktualisiert die Übersicht periodisch nur während eines aktiven Laufs', async function () {
        const client = new QueryClient()
        const options = backupOverviewQueryOptions()
        type Overview = Awaited<ReturnType<typeof getBackupOverviewHandler>>
        const query = client
            .getQueryCache()
            .build<Overview, Error, Overview, typeof ADMIN_BACKUPS_QUERY_KEY>(
                client,
                options,
            )
        const interval = options.refetchInterval
        if (typeof interval !== 'function')
            throw new Error('Missing interval policy')
        expect(interval(query)).toBe(false)
        await client.fetchQuery(options)
        expect(interval(query)).toBe(false)

        await forEachSequentially(
            ['queued', 'running', 'completed', 'failed'],
            async function (status) {
                mocks.runs = [{ status }]
                await client.fetchQuery(options)
                expect(interval(query)).toBe(
                    status === 'queued' || status === 'running' ? 3000 : false,
                )
            },
        )
        expect(options.refetchIntervalInBackground).toBe(false)
        client.clear()
    })

    it('stoppt die Fortschrittsabfrage nach Abschluss trotz noch gesetzter Run-ID', async function () {
        const client = new QueryClient()
        const runId = '019f5b07-80e2-7000-8000-000000000001'
        const options = backupCreationProgressQueryOptions(runId)
        const query = client
            .getQueryCache()
            .build<
                BackupRunCreationProgress | null,
                Error,
                BackupRunCreationProgress | null,
                Array<string>
            >(client, options)
        const interval = options.refetchInterval
        if (typeof interval !== 'function')
            throw new Error('Missing interval policy')
        expect(interval(query)).toBe(750)

        await forEachSequentially(
            ['queued', 'running', 'completed', 'failed'] as const,
            async function (status) {
                mocks.progress = {
                    runId,
                    trigger: 'manual',
                    status,
                    phase: 'preparing',
                    processedBytes: 0,
                    totalBytes: 0,
                    fileName: null,
                    errorMessage: null,
                }
                await client.fetchQuery(options)
                expect(interval(query)).toBe(
                    status === 'queued' || status === 'running' ? 750 : false,
                )
            },
        )
        expect(mocks.getProgress).toHaveBeenCalledWith({ data: { runId } })
        expect(options.refetchIntervalInBackground).toBe(false)
        client.clear()
    })

    it('sucht im Leerlauf nicht periodisch nach neuen aktiven Backups', async function () {
        const client = new QueryClient()
        const options = backupCreationProgressQueryOptions(null)
        const query = client
            .getQueryCache()
            .build<
                BackupRunCreationProgress | null,
                Error,
                BackupRunCreationProgress | null,
                Array<string>
            >(client, options)
        const interval = options.refetchInterval
        if (typeof interval !== 'function')
            throw new Error('Missing interval policy')
        expect(interval(query)).toBe(false)
        await client.fetchQuery(options)
        expect(interval(query)).toBe(false)
        expect(mocks.getProgress).toHaveBeenCalledWith({
            data: { runId: undefined },
        })
        client.clear()
    })
})
