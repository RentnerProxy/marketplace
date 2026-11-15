import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import type { BackupImportAdmission } from '@/server/Admin/Backups/import.types.ts'

const core = vi.fn(async (_binary: string, request: Record<string, unknown>) =>
    request.operation === 'admissionAcquire' ? { token: 'lease-token' } : null,
)
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: async (name: string) => '/owned/' + name,
}))
const { acquireBackupImportAdmissionService: acquire } =
    await import('@/server/Admin/Backups/import-admission.service.ts')
const leases: BackupImportAdmission[] = []
async function admit(
    maximumUploadBytes = 100,
    signal = new AbortController().signal,
) {
    const lease = await acquire({ maximumUploadBytes, requestSignal: signal })
    leases.push(lease)
    return lease
}
beforeEach(() => {
    core.mockClear()
    core.mockImplementation(async (_binary, request) =>
        request.operation === 'admissionAcquire'
            ? { token: 'lease-token' }
            : null,
    )
})
afterEach(async () => {
    vi.useRealTimers()
    await Promise.allSettled(leases.splice(0).map((lease) => lease.release()))
})

describe('Import admission core adapter', () => {
    it('acquires a native token, serializes reservations and releases once', async () => {
        const lease = await admit()
        await Promise.all([lease.beforeWrite(30), lease.beforeWrite(40)])
        expect(core.mock.calls.map((call) => call[1].operation)).toEqual([
            'admissionAcquire',
            'admissionReserve',
        ])
        expect(core.mock.calls[1][1]).toMatchObject({
            token: 'lease-token',
            byteLength: 230,
        })
        const release = lease.release()
        expect(lease.release()).toBe(release)
        await release
        expect(core.mock.calls.at(-1)?.[1]).toMatchObject({
            operation: 'admissionRelease',
            token: 'lease-token',
        })
        expect(() => lease.assertActive()).toThrow()
    })
    it.each([
        ['ARCHIVE_IMPORT_BUSY', 429],
        ['ARCHIVE_CAPACITY_EXCEEDED', 507],
        ['ARCHIVE_BUDGET_EXCEEDED', 507],
        ['CORE_CANCELLED', 408],
        ['ARCHIVE_CAPACITY_UNAVAILABLE', 503],
        ['ARCHIVE_CLEANUP_INCOMPLETE', 503],
    ] as const)(
        'maps native %s errors to HTTP status %s',
        async (code, status) => {
            core.mockRejectedValueOnce(
                Object.assign(new Error('Native failure'), { code }),
            )
            await expect(admit()).rejects.toMatchObject({ status })
        },
    )
    it('rejects malformed budgets and requests aborted before admission', async () => {
        await Promise.all(
            [-1, 0.5, Number.NaN, BACKUP_LIMITS.maxArchiveBytes + 1].map(
                (size) => expect(admit(size)).rejects.toThrow(),
            ),
        )
        const controller = new AbortController()
        controller.abort()
        await expect(admit(100, controller.signal)).rejects.toMatchObject({
            status: 408,
        })
        expect(core).not.toHaveBeenCalled()
    })
    it('retains the native marker if cleanup is incomplete', async () => {
        const lease = await admit()
        lease.markCleanupIncomplete()
        await lease.release()
        expect(core.mock.calls.map((call) => call[1].operation)).toEqual([
            'admissionAcquire',
            'admissionMarkIncomplete',
            'admissionRelease',
        ])
    })
    it('holds the lease until an in-flight native reservation settles', async () => {
        const lease = await admit()
        const deferred = Promise.withResolvers<null>()
        core.mockImplementationOnce(async () => deferred.promise)
        const pending = lease.beforeWrite(1)
        await Promise.resolve()
        const release = lease.release()
        await Promise.resolve()
        expect(
            core.mock.calls.some(
                (call) => call[1].operation === 'admissionRelease',
            ),
        ).toBe(false)
        deferred.resolve(null)
        await expect(pending).rejects.toThrow()
        await release
        expect(core.mock.calls.at(-1)?.[1].operation).toBe('admissionRelease')
    })
    it('aborts a live context and prevents excess or invalid write reservations', async () => {
        const controller = new AbortController()
        const lease = await admit(100, controller.signal)
        controller.abort()
        expect(() => lease.assertActive()).toThrow()
        await expect(lease.beforeWrite(1)).rejects.toMatchObject({
            status: 408,
        })
        const second = await admit()
        await expect(second.beforeWrite(231)).rejects.toMatchObject({
            status: 507,
        })
        const third = await admit()
        await expect(third.beforeWrite(-1)).rejects.toMatchObject({
            status: 507,
        })
    })
})
