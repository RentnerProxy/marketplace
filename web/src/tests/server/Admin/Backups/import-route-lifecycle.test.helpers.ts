import { vi } from 'bun:test'
import { BackupImportError } from '@/server/Admin/Backups/backup.errors.ts'
import type {
    AcquireBackupImportAdmissionInput,
    BackupImportAdmission,
    BackupImportContext,
} from '@/server/Admin/Backups/Types/import.types.ts'
import type { RegisterImportedBackupInput } from '@/server/Admin/Backups/Types/backup-service.types.ts'
import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import { validateBackupUploadRequest as actualValidateUpload } from '@/server/Admin/Backups/upload.service.ts'

const validateUpload = actualValidateUpload

export function createImportRouteLifecycleHarness() {
    const state = {
        events: [] as Array<string>,
        failures: new Map<string, unknown>(),
        hooks: new Map<string, () => void>(),
        marker: false,
        cleanupIncomplete: false,
        uploadExists: false,
        staged: false,
        published: false,
        committed: false,
        expired: false,
        readBytes: 0,
    }
    const receipt: AuditReceipt = {
        id: '019f5b07-80e2-7000-8000-000000000099',
        createdAt: new Date('2026-09-06T12:00:00Z'),
    }
    function failAt(stage: string) {
        if (state.failures.has(stage)) throw state.failures.get(stage)
    }
    const context: BackupImportAdmission = {
        signal: new AbortController().signal,
        maximumUploadBytes: 0,
        temporaryDirectory: '/synthetic-backups/.import-admission',
        assertActive: vi.fn(function () {
            if (context.signal.aborted || state.expired) {
                throw new BackupImportError(
                    408,
                    'Der Backup-Import wurde abgebrochen.',
                )
            }
        }),
        beforeWrite: vi.fn(async function () {}),
        markCleanupIncomplete: vi.fn(function () {
            state.events.push('cleanup-incomplete')
            state.cleanupIncomplete = true
        }),
        release: vi.fn(async function () {
            state.events.push('release')
            failAt('release')
            if (state.cleanupIncomplete) {
                throw new BackupImportError(
                    503,
                    'Weitere Imports bleiben gesperrt.',
                )
            }
            state.marker = false
        }),
    }
    const sameOrigin = vi.fn(function () {
        state.events.push('origin')
        failAt('origin')
    })
    const rateLimit = vi.fn(async function () {
        state.events.push('rate-limit')
        failAt('rate-limit')
    })
    const permission = vi.fn(async function () {
        state.events.push('permission')
        failAt('permission')
        return {
            userId: '019f5b07-80e2-7000-8000-000000000001',
            permissionKeys: ['admin.backups'],
        }
    })
    const validate = vi.fn(function (request: Request) {
        state.events.push('validate-request')
        return validateUpload(request)
    })
    const acquire = vi.fn(async function (
        input: AcquireBackupImportAdmissionInput,
    ) {
        state.events.push('acquire')
        if (state.marker) {
            throw new BackupImportError(
                429,
                'Es läuft bereits ein Backup-Import.',
            )
        }
        failAt('acquire')
        context.signal = input.requestSignal
        context.maximumUploadBytes = input.maximumUploadBytes
        context.assertActive()
        state.marker = true
        return context
    })
    const uploadDispose = vi.fn(async function () {
        state.events.push('dispose-upload')
        failAt('upload-cleanup')
        state.uploadExists = false
    })
    const receive = vi.fn(async function (
        request: Request,
        _context: BackupImportContext,
    ) {
        state.events.push('upload')
        failAt('upload')
        state.readBytes += (await request.arrayBuffer()).byteLength
        state.uploadExists = true
        state.hooks.get('after-upload')?.()
        return {
            filePath: '/synthetic-backups/.import-admission/upload.partial',
            dispose: uploadDispose,
        }
    })
    const archiveDispose = vi.fn(async function () {
        state.events.push('dispose-archive')
        failAt('archive-cleanup')
        state.published = false
        state.staged = false
    })
    const publish = vi.fn(async function () {
        state.events.push('publish-archive')
        failAt('publish')
        state.published = true
        state.hooks.get('after-publish')?.()
    })
    const stageBackup = vi.fn(async function (
        _filePath: string,
        _context: BackupImportContext,
    ) {
        state.events.push('stage')
        failAt('stage')
        state.staged = true
        state.hooks.get('after-stage')?.()
        return {
            fileName: 'import-synthetic.tanstack-backup.tar',
            fileSize: 4,
            checksumSha256: 'a'.repeat(64),
            includesStorage: false,
            publish,
            dispose: archiveDispose,
        }
    })
    const register = vi.fn(async function (
        _input: RegisterImportedBackupInput,
        publishArchive: () => Promise<void>,
    ) {
        state.events.push('register')
        failAt('register')
        state.hooks.get('before-publish')?.()
        await publishArchive()
        failAt('commit')
        state.committed = true
        state.events.push('commit')
        state.hooks.get('after-commit')?.()
        return {
            runId: '019f5b07-80e2-7000-8000-000000000002',
            auditReceipt: receipt,
        }
    })
    const publishAudit = vi.fn(async function (_receipt: AuditReceipt) {
        state.events.push('publish-audit')
        failAt('audit-publish')
    })
    const retention = vi.fn(async function (_protectedRunIds: Set<string>) {
        state.events.push('retention')
        failAt('retention')
    })
    const logError = vi.fn()

    function install() {
        vi.mock('@tanstack/react-router', () => ({
            createFileRoute: () => (options: unknown) => options,
        }))
        vi.mock('@/server/Request/sameOrigin.service.ts', () => ({
            assertSameOriginRequest: sameOrigin,
            SameOriginRequestError: class SameOriginRequestError extends Error {},
        }))
        vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
            enforceRateLimit: rateLimit,
            RateLimitError: class RateLimitError extends Error {},
        }))
        vi.mock('@/server/Auth/authorization.service.ts', () => ({
            requirePermissionService: permission,
        }))
        vi.mock('@/server/Admin/Backups/upload.service.ts', () => ({
            receiveBackupUpload: receive,
            validateBackupUploadRequest: validate,
        }))
        vi.mock('@/server/Admin/Backups/import-admission.service.ts', () => ({
            acquireBackupImportAdmissionService: acquire,
        }))
        vi.mock('@/server/Admin/Backups/archive-import.service.ts', () => ({
            prepareUploadedBackupImport: stageBackup,
        }))
        vi.mock('@/server/Admin/Backups/run-create.service.ts', () => ({
            registerImportedBackupService: register,
        }))
        vi.mock('@/lib/AuditLogs/auditLogs.ts', () => ({
            publishCommittedAuditLogService: publishAudit,
        }))
        vi.mock('@/server/Admin/Backups/run-retention.service.ts', () => ({
            applyBackupRetentionBestEffort: retention,
        }))
        vi.mock('@/server/Logging/logger.ts', () => ({ logError }))
    }
    function reset() {
        vi.clearAllMocks()
        state.events.length = 0
        state.failures.clear()
        state.hooks.clear()
        state.marker = false
        state.cleanupIncomplete = false
        state.uploadExists = false
        state.staged = false
        state.published = false
        state.committed = false
        state.expired = false
        state.readBytes = 0
        context.signal = new AbortController().signal
    }
    return {
        state,
        receipt,
        context,
        sameOrigin,
        rateLimit,
        permission,
        validate,
        acquire,
        receive,
        stageBackup,
        register,
        publish,
        publishAudit,
        retention,
        uploadDispose,
        archiveDispose,
        logError,
        install,
        reset,
    }
}
