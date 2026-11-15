import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as actualBackupQueue from '@/server/Admin/Backups/backup.queue.ts'

const mocks = (function () {
    return {
        getActiveCreateBackupRun: vi.fn(),
        getBackupRunById: vi.fn(),
        getJob: vi.fn(),
        getJobs: vi.fn(),
    }
})()

const actualBackupQueueExports = { ...actualBackupQueue }

vi.mock('@/server/Admin/Backups/backup.queue.ts', function () {
    return {
        ...actualBackupQueueExports,
        getBackupQueue: function () {
            return {
                getJob: mocks.getJob,
                getJobs: mocks.getJobs,
            }
        },
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return {
        getActiveCreateBackupRun: mocks.getActiveCreateBackupRun,
        getBackupRunById: mocks.getBackupRunById,
    }
})

import { getBackupCreationProgressService } from '@/server/Admin/Backups/progress.service.ts'

function createRun(
    overrides: Partial<{
        errorMessage: string | null
        fileName: string | null
        fileSize: number | null
        id: string
        status: string
        trigger: string
    }> = {},
) {
    return {
        id: '0198f518-9db7-7000-8000-000000000001',
        trigger: 'manual',
        status: 'running',
        fileName: null,
        fileSize: null,
        errorMessage: null,
        ...overrides,
    }
}

function createJob(
    progress: unknown,
    runId = '0198f518-9db7-7000-8000-000000000001',
) {
    return {
        data: {
            kind: 'create',
            runId,
            trigger: 'manual',
        },
        progress,
    }
}

beforeEach(function () {
    vi.clearAllMocks()
    mocks.getJob.mockResolvedValue(null)
    mocks.getJobs.mockResolvedValue([])
    mocks.getActiveCreateBackupRun.mockResolvedValue(null)
    mocks.getBackupRunById.mockResolvedValue(null)
})

describe('Backup-Erstellungsfortschritt', function () {
    it('liefert den validierten BullMQ-Fortschritt eines verfolgten Runs', async function () {
        const run = createRun()
        mocks.getBackupRunById.mockResolvedValue(run)
        mocks.getJob.mockResolvedValue(
            createJob({
                version: 1,
                phase: 'archiving',
                processedBytes: 25,
                totalBytes: 100,
            }),
        )

        await expect(getBackupCreationProgressService(run.id)).resolves.toEqual(
            {
                runId: run.id,
                trigger: 'manual',
                status: 'running',
                phase: 'archiving',
                processedBytes: 25,
                totalBytes: 100,
                fileName: null,
                errorMessage: null,
            },
        )
    })

    it.each(['failed', 'queued'])(
        'redigiert historische Fehlertexte eines %s-Runs vor der Clientantwort',
        async function (status) {
            const run = createRun({
                status,
                errorMessage:
                    'SELECT secret FROM private_table; C:\\private\\synthetic-backup.tar',
            })
            mocks.getBackupRunById.mockResolvedValue(run)
            const result = await getBackupCreationProgressService(run.id)
            expect(result?.errorMessage).toBe(
                'Der Backup-Vorgang ist fehlgeschlagen.',
            )
            expect(result?.status).toBe(status)
            expect(JSON.stringify(result)).not.toContain('private')
            expect(run.errorMessage).toContain('private_table')
        },
    )

    it('findet einen geplanten Run über bounded aktive Queue-Jobs', async function () {
        const run = createRun({ trigger: 'scheduled' })
        mocks.getActiveCreateBackupRun.mockResolvedValue(run)
        mocks.getJobs.mockResolvedValue([
            createJob(
                {
                    version: 1,
                    phase: 'collecting',
                    processedBytes: 0,
                    totalBytes: 0,
                },
                run.id,
            ),
        ])

        await expect(getBackupCreationProgressService()).resolves.toEqual(
            expect.objectContaining({
                runId: run.id,
                trigger: 'scheduled',
                phase: 'collecting',
            }),
        )
        expect(mocks.getJobs).toHaveBeenCalledWith(['active'], 0, 9, true)
    })

    it('fällt bei ungültigem oder verlorenem Valkey-Fortschritt sicher auf den DB-Status zurück', async function () {
        const run = createRun()
        mocks.getBackupRunById.mockResolvedValue(run)
        mocks.getJob.mockRejectedValue(new Error('valkey unavailable'))

        await expect(getBackupCreationProgressService(run.id)).resolves.toEqual(
            expect.objectContaining({
                status: 'running',
                phase: 'preparing',
                processedBytes: 0,
                totalBytes: 0,
            }),
        )
    })

    it('liefert den terminalen DB-Stand auch nach Entfernung des Queue-Jobs', async function () {
        const run = createRun({
            status: 'completed',
            fileName: 'backup.tanstack-backup.tar',
            fileSize: 4096,
        })
        mocks.getBackupRunById.mockResolvedValue(run)

        await expect(getBackupCreationProgressService(run.id)).resolves.toEqual(
            expect.objectContaining({
                status: 'completed',
                phase: 'finalizing',
                processedBytes: 4096,
                totalBytes: 4096,
                fileName: 'backup.tanstack-backup.tar',
            }),
        )
    })

    it('ignoriert veralteten Queue-Fortschritt für einen abgeschlossenen Run', async function () {
        const run = createRun({
            status: 'completed',
            fileName: 'backup.tanstack-backup.tar',
            fileSize: 4096,
        })
        mocks.getBackupRunById.mockResolvedValue(run)
        mocks.getJob.mockResolvedValue(
            createJob({
                version: 1,
                phase: 'archiving',
                processedBytes: 1,
                totalBytes: 1,
            }),
        )

        await expect(getBackupCreationProgressService(run.id)).resolves.toEqual(
            expect.objectContaining({
                status: 'completed',
                phase: 'finalizing',
                processedBytes: 4096,
                totalBytes: 4096,
            }),
        )
    })

    it('setzt veralteten Fortschritt während eines Retry-Backoffs auf queued zurück', async function () {
        const run = createRun({ status: 'queued' })
        mocks.getBackupRunById.mockResolvedValue(run)
        mocks.getJob.mockResolvedValue(
            createJob({
                version: 1,
                phase: 'finalizing',
                processedBytes: 100,
                totalBytes: 100,
            }),
        )

        await expect(getBackupCreationProgressService(run.id)).resolves.toEqual(
            expect.objectContaining({
                status: 'queued',
                phase: 'queued',
                processedBytes: 0,
                totalBytes: 0,
            }),
        )
    })
})
