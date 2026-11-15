import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { getBackupQueue } from '@/server/Admin/Backups/backup.queue.ts'
import {
    getStaleActiveBackupRuns,
    markRunAsQueueFailed,
} from '@/server/Admin/Backups/run-registry.service.ts'
import { reconcileLostBackupQueueState } from '@/server/Admin/Backups/backup-recovery.service.ts'

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    return {
        getBackupQueue: vi.fn(),
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return {
        getStaleActiveBackupRuns: vi.fn(),
        markRunAsQueueFailed: vi.fn(),
    }
})

const mockedGetStaleActiveBackupRuns = getStaleActiveBackupRuns as Mock<
    typeof getStaleActiveBackupRuns
>
const mockedGetBackupQueue = getBackupQueue as Mock<typeof getBackupQueue>

describe('Wiederherstellung des flüchtigen Backup-Queuezustands', function () {
    beforeEach(function () {
        vi.clearAllMocks()
    })

    it('markiert nur verwaiste PostgreSQL-Läufe als fehlgeschlagen', async function () {
        mockedGetStaleActiveBackupRuns.mockResolvedValue([
            { id: 'active-run' },
            { id: 'queued-run' },
            { id: 'lost-run' },
        ])
        mockedGetBackupQueue.mockReturnValue({
            getJob: vi.fn(async function (runId: string) {
                return runId === 'queued-run' ? { id: runId } : undefined
            }),
        } as never)

        await reconcileLostBackupQueueState(
            new Set(['active-run']),
            new Date('2026-01-01T00:02:00.000Z'),
        )

        expect(getStaleActiveBackupRuns).toHaveBeenCalledWith(
            new Date('2026-01-01T00:01:00.000Z'),
        )
        expect(markRunAsQueueFailed).toHaveBeenCalledTimes(1)
        expect(markRunAsQueueFailed).toHaveBeenCalledWith(
            'lost-run',
            expect.any(Error),
        )
    })
})
