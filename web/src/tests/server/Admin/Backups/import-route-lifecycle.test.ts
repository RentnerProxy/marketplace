import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import { BackupImportError } from '@/server/Admin/Backups/import.errors.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from '@/server/Auth/authorization.errors.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { createImportRouteLifecycleHarness } from './import-route-lifecycle.test.helpers.ts'

const harness = createImportRouteLifecycleHarness()
harness.install()
const { SameOriginRequestError } =
    await import('@/server/Request/sameOrigin.service.ts')
const { RateLimitError } =
    await import('@/server/RateLimit/rateLimit.service.ts')
const { handleBackupImport } =
    await import('@/routes/api/admin/backups/import.ts')

function createUploadRequest(
    headers: Record<string, string | undefined> = {},
    signal?: AbortSignal,
) {
    const requestHeaders = new Headers({
        'content-type': 'application/octet-stream',
    })
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) requestHeaders.set(name, value)
    }
    const pull = vi.fn(function (
        controller: ReadableStreamDefaultController<Uint8Array>,
    ) {
        controller.enqueue(new TextEncoder().encode('data'))
        controller.close()
    })
    const request = new Request(
        'https://app.example.test/api/admin/backups/import',
        {
            method: 'POST',
            headers: requestHeaders,
            body: new ReadableStream({ pull }, { highWaterMark: 0 }),
            signal,
        },
    )
    return { request, pull }
}

function expectNoImportWork() {
    expect(harness.receive).not.toHaveBeenCalled()
    expect(harness.copy).not.toHaveBeenCalled()
    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.publishAudit).not.toHaveBeenCalled()
    expect(harness.retention).not.toHaveBeenCalled()
    expect(harness.state.readBytes).toBe(0)
}

beforeEach(function () {
    harness.reset()
})

describe('Backup import admission route lifecycle', function () {
    it('orders guards, real request validation, admission, publication, audit and cleanup', async function () {
        const { request } = createUploadRequest({ 'content-length': '4' })
        const response = await handleBackupImport({ request })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            runId: '019f5b07-80e2-7000-8000-000000000002',
        })
        expect(harness.state.events).toEqual([
            'origin',
            'rate-limit',
            'permission',
            'validate-request',
            'acquire',
            'upload',
            'copy',
            'register',
            'publish-archive',
            'commit',
            'publish-audit',
            'retention',
            'dispose-upload',
            'release',
        ])
        expect(harness.acquire).toHaveBeenCalledWith({
            requestSignal: request.signal,
            maximumUploadBytes: 4,
        })
        expect(harness.receive).toHaveBeenCalledWith(request, harness.context)
        expect(harness.copy).toHaveBeenCalledWith(
            '/synthetic-backups/.import-admission/upload.enc',
            harness.context,
        )
        expect(harness.register).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: '019f5b07-80e2-7000-8000-000000000001',
            }),
            expect.any(Function),
        )
        expect(harness.register.mock.calls[0]?.[1]).not.toBe(harness.publish)
        expect(harness.publishAudit).toHaveBeenCalledWith(harness.receipt)
        expect(harness.retention).toHaveBeenCalledWith(
            new Set(['019f5b07-80e2-7000-8000-000000000002']),
        )
        expect(harness.state.readBytes).toBe(4)
        expect(harness.state.marker).toBe(false)
        expect(harness.archiveDispose).not.toHaveBeenCalled()
    })

    it('reserves the full configured archive bound when Content-Length is absent', async function () {
        const { request } = createUploadRequest()
        await handleBackupImport({ request })
        expect(harness.acquire).toHaveBeenCalledWith({
            requestSignal: request.signal,
            maximumUploadBytes: BACKUP_LIMITS.maxArchiveBytes,
        })
    })

    it.each([
        { 'content-type': 'multipart/form-data; boundary=legacy' },
        { 'content-length': 'invalid' },
        { 'content-length': String(BACKUP_LIMITS.maxArchiveBytes + 1) },
    ])(
        'rejects invalid upload metadata before acquiring or reading any bytes: %j',
        async function (headers) {
            const { request, pull } = createUploadRequest(headers)
            const response = await handleBackupImport({ request })
            expect(response.status).toBe(400)
            expect(harness.acquire).not.toHaveBeenCalled()
            expect(request.bodyUsed).toBe(false)
            expect(pull).not.toHaveBeenCalled()
            expectNoImportWork()
        },
    )

    it('rejects a missing body before admission', async function () {
        const request = new Request(
            'https://app.example.test/api/admin/backups/import',
            {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
            },
        )
        expect((await handleBackupImport({ request })).status).toBe(400)
        expect(harness.acquire).not.toHaveBeenCalled()
        expectNoImportWork()
    })

    it.each([
        [new AuthenticationRequiredError(), 401],
        [new PermissionDeniedError(), 403],
        [new MaintenanceModeError(), 503],
    ] as const)(
        'enforces authorization before validation, admission and body consumption: %j',
        async function (error, status) {
            const { request, pull } = createUploadRequest()
            harness.state.failures.set('permission', error)
            expect((await handleBackupImport({ request })).status).toBe(status)
            expect(harness.validate).not.toHaveBeenCalled()
            expect(harness.acquire).not.toHaveBeenCalled()
            expect(pull).not.toHaveBeenCalled()
            expect(request.bodyUsed).toBe(false)
            expectNoImportWork()
        },
    )

    it.each([408, 429, 503, 507] as const)(
        'preserves admission status %s before reading the body or creating an upload',
        async function (status) {
            const { request, pull } = createUploadRequest()
            harness.state.failures.set(
                'acquire',
                new BackupImportError(status, 'Sichere Admission-Ablehnung.'),
            )
            const response = await handleBackupImport({ request })
            expect(response.status).toBe(status)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(response.headers.get('retry-after')).toBe(
                status === 429 ? '5' : null,
            )
            expect(await response.json()).toEqual({
                success: false,
                error: 'Sichere Admission-Ablehnung.',
            })
            expect(pull).not.toHaveBeenCalled()
            expect(request.bodyUsed).toBe(false)
            expect(harness.context.release).not.toHaveBeenCalled()
            expect(harness.state.marker).toBe(false)
            expectNoImportWork()
        },
    )

    it.each(['upload', 'copy'] as const)(
        'preserves a disk error in the %s stage and releases admission after cleanup',
        async function (stage) {
            harness.state.failures.set(
                stage,
                new BackupImportError(507, 'Speicherbudget erschöpft.'),
            )
            const response = await handleBackupImport(createUploadRequest())
            expect(response.status).toBe(507)
            expect(harness.register).not.toHaveBeenCalled()
            expect(harness.context.release).toHaveBeenCalledTimes(1)
            expect(harness.uploadDispose).toHaveBeenCalledTimes(
                stage === 'copy' ? 1 : 0,
            )
            expect(harness.state.events.at(-1)).toBe('release')
            expect(harness.state.marker).toBe(false)
        },
    )
    it.each(['upload', 'copy'] as const)(
        'preserves the primary disk status when %s cleanup also fails',
        async function (stage) {
            const controller = new AbortController()
            const { request } = createUploadRequest({}, controller.signal)
            const primaryError = new BackupImportError(
                507,
                'Speicherbudget erschöpft.',
            )
            const failingOperation =
                stage === 'upload' ? harness.receive : harness.copy
            failingOperation.mockImplementationOnce(async function () {
                controller.abort()
                harness.context.markCleanupIncomplete()
                throw new AggregateError(
                    [primaryError, new Error('private-cleanup-path')],
                    'Import und Bereinigung fehlgeschlagen.',
                    { cause: primaryError },
                )
            })
            const response = await handleBackupImport({ request })
            expect(response.status).toBe(507)
            expect(await response.json()).toEqual({
                success: false,
                error: 'Speicherbudget erschöpft.',
            })
            expect(harness.register).not.toHaveBeenCalled()
            expect(harness.publishAudit).not.toHaveBeenCalled()
            expect(harness.retention).not.toHaveBeenCalled()
            expect(harness.context.markCleanupIncomplete).toHaveBeenCalledTimes(
                1,
            )
            expect(harness.context.release).toHaveBeenCalledTimes(1)
            expect(harness.uploadDispose).toHaveBeenCalledTimes(
                stage === 'copy' ? 1 : 0,
            )
            expect(harness.state.marker).toBe(true)
        },
    )
    it.each([
        'after-upload',
        'after-copy',
        'before-publish',
        'after-publish',
    ] as const)(
        'aborts at %s and cleans exactly the resources acquired before that point',
        async function (stage) {
            const controller = new AbortController()
            const { request } = createUploadRequest({}, controller.signal)
            harness.state.hooks.set(stage, () => controller.abort())
            const response = await handleBackupImport({ request })
            expect(response.status).toBe(408)
            expect(harness.state.committed).toBe(false)
            expect(harness.publishAudit).not.toHaveBeenCalled()
            expect(harness.retention).not.toHaveBeenCalled()
            expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
            expect(harness.archiveDispose).toHaveBeenCalledTimes(
                stage === 'after-upload' ? 0 : 1,
            )
            expect(harness.publish).toHaveBeenCalledTimes(
                stage === 'after-publish' ? 1 : 0,
            )
            expect(harness.context.release).toHaveBeenCalledTimes(1)
            expect(harness.state.events.at(-1)).toBe('release')
            expect(harness.state.marker).toBe(false)
            expect(harness.state.published).toBe(false)
        },
    )

    it('checks the admission deadline independently of the HTTP AbortSignal', async function () {
        const { request } = createUploadRequest()
        harness.state.hooks.set('after-copy', () => {
            harness.state.expired = true
        })
        const response = await handleBackupImport({ request })
        expect(request.signal.aborted).toBe(false)
        expect(response.status).toBe(408)
        expect(harness.register).not.toHaveBeenCalled()
        expect(harness.archiveDispose).toHaveBeenCalledTimes(1)
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
    })

    it('keeps a confirmed import successful when the client aborts immediately after commit', async function () {
        const controller = new AbortController()
        const { request } = createUploadRequest({}, controller.signal)
        harness.state.hooks.set('after-commit', () => controller.abort())
        const response = await handleBackupImport({ request })
        expect(response.status).toBe(200)
        expect(harness.state.committed).toBe(true)
        expect(harness.state.published).toBe(true)
        expect(harness.publishAudit).toHaveBeenCalledWith(harness.receipt)
        expect(harness.retention).toHaveBeenCalledTimes(1)
        expect(harness.archiveDispose).not.toHaveBeenCalled()
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
    })

    it.each(['register', 'commit'] as const)(
        'cleans the staged or already published archive if %s fails',
        async function (stage) {
            harness.state.failures.set(
                stage,
                new Error('private-database-error'),
            )
            const response = await handleBackupImport(createUploadRequest())
            expect(response.status).toBe(500)
            expect(await response.text()).not.toContain(
                'private-database-error',
            )
            expect(harness.state.committed).toBe(false)
            expect(harness.state.published).toBe(false)
            expect(harness.publish).toHaveBeenCalledTimes(
                stage === 'commit' ? 1 : 0,
            )
            expect(harness.archiveDispose).toHaveBeenCalledTimes(1)
            expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
            expect(harness.context.release).toHaveBeenCalledTimes(1)
            expect(harness.publishAudit).not.toHaveBeenCalled()
            expect(harness.retention).not.toHaveBeenCalled()
        },
    )

    it('keeps HTTP success, audit and retention after upload cleanup fails, while retaining the marker', async function () {
        const cleanupError = new Error('private-upload-path')
        harness.state.failures.set('upload-cleanup', cleanupError)
        const response = await handleBackupImport(createUploadRequest())
        expect(response.status).toBe(200)
        expect(harness.state.committed).toBe(true)
        expect(harness.state.published).toBe(true)
        expect(harness.context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        expect(harness.state.marker).toBe(true)
        expect(harness.archiveDispose).not.toHaveBeenCalled()
        expect(harness.publishAudit).toHaveBeenCalledWith(harness.receipt)
        expect(harness.retention).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.logError).toHaveBeenCalledWith(
            'backup.import.upload_cleanup_failed',
            cleanupError,
        )
        const blocked = createUploadRequest()
        const retry = await handleBackupImport(blocked)
        expect(retry.status).toBe(429)
        expect(retry.headers.get('retry-after')).toBe('5')
        expect(blocked.pull).not.toHaveBeenCalled()
        expect(harness.receive).toHaveBeenCalledTimes(1)
    })

    it('marks archive cleanup failure, still disposes the upload and leaves admission closed', async function () {
        harness.state.failures.set('commit', new Error('private-commit-error'))
        const cleanupError = new Error('private-archive-path')
        harness.state.failures.set('archive-cleanup', cleanupError)
        const response = await handleBackupImport(createUploadRequest())
        expect(response.status).toBe(500)
        expect(harness.state.committed).toBe(false)
        expect(harness.context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.state.marker).toBe(true)
        expect(harness.logError).toHaveBeenCalledWith(
            'backup.import.archive_cleanup_failed',
            cleanupError,
        )
        expect(harness.publishAudit).not.toHaveBeenCalled()
        expect(harness.retention).not.toHaveBeenCalled()
    })

    it('preserves a committed success if releasing the empty admission marker fails', async function () {
        const cleanupError = new Error('private-marker-path')
        harness.state.failures.set('release', cleanupError)
        const response = await handleBackupImport(createUploadRequest())
        expect(response.status).toBe(200)
        expect(harness.state.committed).toBe(true)
        expect(harness.state.marker).toBe(true)
        expect(harness.archiveDispose).not.toHaveBeenCalled()
        expect(harness.publishAudit).toHaveBeenCalledTimes(1)
        expect(harness.retention).toHaveBeenCalledTimes(1)
        expect(harness.logError).toHaveBeenCalledWith(
            'backup.import.admission_cleanup_failed',
            cleanupError,
        )
    })

    it('keeps the slot occupied until upload cleanup settles and admits a later request afterwards', async function () {
        const cleanupStarted = Promise.withResolvers<void>()
        const cleanupAllowed = Promise.withResolvers<void>()
        harness.uploadDispose.mockImplementationOnce(async function () {
            harness.state.events.push('dispose-upload')
            cleanupStarted.resolve()
            await cleanupAllowed.promise
            harness.state.uploadExists = false
        })
        const pendingResponse = handleBackupImport(createUploadRequest())
        await cleanupStarted.promise
        expect(harness.context.release).not.toHaveBeenCalled()
        const blocked = createUploadRequest()
        const busyResponse = await handleBackupImport(blocked)
        expect(busyResponse.status).toBe(429)
        expect(busyResponse.headers.get('retry-after')).toBe('5')
        expect(blocked.request.bodyUsed).toBe(false)
        expect(blocked.pull).not.toHaveBeenCalled()
        expect(harness.receive).toHaveBeenCalledTimes(1)
        cleanupAllowed.resolve()
        expect((await pendingResponse).status).toBe(200)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.state.marker).toBe(false)
        expect((await handleBackupImport(createUploadRequest())).status).toBe(
            200,
        )
        expect(harness.receive).toHaveBeenCalledTimes(2)
        expect(harness.context.release).toHaveBeenCalledTimes(2)
    })
    it.each(['origin', 'rate-limit'] as const)(
        'rejects the %s guard before authentication, admission or body consumption',
        async function (stage) {
            const { request, pull } = createUploadRequest()
            const error =
                stage === 'origin'
                    ? new SameOriginRequestError()
                    : Object.assign(new RateLimitError(9), {
                          retryAfterSeconds: 9,
                      })
            harness.state.failures.set(stage, error)
            const response = await handleBackupImport({ request })
            expect(response.status).toBe(stage === 'origin' ? 403 : 429)
            expect(harness.permission).not.toHaveBeenCalled()
            expect(harness.validate).not.toHaveBeenCalled()
            expect(harness.acquire).not.toHaveBeenCalled()
            expect(pull).not.toHaveBeenCalled()
            expect(request.bodyUsed).toBe(false)
            expectNoImportWork()
        },
    )

    it('gibt beim Actor-Widerruf nach dem Staging 403 zurück und bereinigt alle temporären Ressourcen', async function () {
        harness.register.mockRejectedValueOnce(new PermissionDeniedError())
        const { request } = createUploadRequest()
        const response = await handleBackupImport({ request })
        expect(response.status).toBe(403)
        expect(harness.receive).toHaveBeenCalledTimes(1)
        expect(harness.copy).toHaveBeenCalledTimes(1)
        expect(harness.publish).not.toHaveBeenCalled()
        expect(harness.publishAudit).not.toHaveBeenCalled()
        expect(harness.retention).not.toHaveBeenCalled()
        expect(harness.archiveDispose).toHaveBeenCalledTimes(1)
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.state.committed).toBe(false)
        expect(harness.state.published).toBe(false)
        expect(harness.state.staged).toBe(false)
        expect(harness.state.uploadExists).toBe(false)
        expect(harness.state.marker).toBe(false)
    })

    it('behält bei Actor-Widerruf und gescheiterter Stage-Bereinigung den Admission-Marker', async function () {
        harness.register.mockRejectedValueOnce(new PermissionDeniedError())
        harness.archiveDispose.mockRejectedValueOnce(
            new Error('Synthetic cleanup failure'),
        )
        const { request } = createUploadRequest()
        expect((await handleBackupImport({ request })).status).toBe(403)
        expect(harness.context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.state.marker).toBe(true)
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.publish).not.toHaveBeenCalled()
        expect(harness.publishAudit).not.toHaveBeenCalled()
    })

    it('priorisiert nach Actor-Widerruf weiterhin den während Cleanup eingetretenen Requestabbruch', async function () {
        harness.register.mockRejectedValueOnce(new PermissionDeniedError())
        harness.archiveDispose.mockImplementationOnce(async function () {
            harness.state.expired = true
            harness.state.staged = false
        })
        const { request } = createUploadRequest()
        expect((await handleBackupImport({ request })).status).toBe(408)
        expect(harness.uploadDispose).toHaveBeenCalledTimes(1)
        expect(harness.context.release).toHaveBeenCalledTimes(1)
        expect(harness.publish).not.toHaveBeenCalled()
        expect(harness.publishAudit).not.toHaveBeenCalled()
        expect(harness.state.marker).toBe(false)
    })
})
