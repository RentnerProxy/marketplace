import { createBackupAuditMocks } from './backupAuditTestUtils.ts'
import { applyBackupRetentionBestEffort } from '@/server/Admin/Backups/run-retention.service.ts'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { rm } from 'node:fs/promises'
import { writeStandaloneAuditLogService } from '@/lib/AuditLogs/auditLogs.ts'
import { prepareUploadedBackupImport } from '@/server/Admin/Backups/archive-import.service.ts'
import {
    createManualBackupForDownloadService,
    registerImportedBackupService,
} from '@/server/Admin/Backups/run-create.service.ts'
import { getBackupRunById } from '@/server/Admin/Backups/run-registry.service.ts'
import { prepareBackupDownloadService } from '@/server/Admin/Backups/download.service.ts'
import { BackupApiError } from '@/server/Admin/Backups/http.service.ts'
import {
    receiveBackupUpload,
    validateBackupUploadRequest,
} from '@/server/Admin/Backups/upload.service.ts'
import { acquireBackupImportAdmissionService } from '@/server/Admin/Backups/import-admission.service.ts'
import type { BackupImportAdmission } from '@/server/Admin/Backups/Types/import.types.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import {
    assertSameOriginRequest,
    SameOriginRequestError,
} from '@/server/Request/sameOrigin.service.ts'
import { handleStoredBackupDownload } from '@/routes/api/admin/backups/$backupId.ts'
import { handleBackupDownload } from '@/routes/api/admin/backups/download.ts'
import { handleBackupImport } from '@/routes/api/admin/backups/import.ts'

const auditMocks = createBackupAuditMocks()
const importState = { published: false }
const downloadMocks = {
    createBody: vi.fn(() => new Blob(['backup']).stream()),
    dispose: vi.fn(async function () {}),
}
const admission: BackupImportAdmission = {
    signal: new AbortController().signal,
    temporaryDirectory: 'C:/Backups/.import-admission',
    maximumUploadBytes: 123,
    assertActive: vi.fn(),
    beforeWrite: vi.fn(async function () {}),
    markCleanupIncomplete: vi.fn(),
    release: vi.fn(async function () {}),
}
const importMocks = {
    publish: vi.fn(async function () {
        importState.published = true
    }),
    dispose: vi.fn(async function () {
        importState.published = false
    }),
}

vi.mock('@tanstack/react-router', function () {
    return {
        createFileRoute: function () {
            return function (options: unknown) {
                return options
            }
        },
    }
})

vi.mock('node:fs/promises', function () {
    return { rm: vi.fn() }
})

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService: auditMocks.prepare,
        publishCommittedAuditLogService: auditMocks.publish,
        writeStandaloneAuditLogService: vi.fn(async function () {}),
    }
})

vi.mock('@/server/Admin/Backups/run-retention.service.ts', function () {
    return { applyBackupRetentionBestEffort: vi.fn(async function () {}) }
})

vi.mock('@/server/Admin/Backups/archive-import.service.ts', function () {
    return { prepareUploadedBackupImport: vi.fn() }
})

vi.mock('@/server/Admin/Backups/run-create.service.ts', function () {
    return {
        createManualBackupForDownloadService: vi.fn(),
        registerImportedBackupService: vi.fn(),
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return { getBackupRunById: vi.fn() }
})

vi.mock('@/server/Admin/Backups/download.service.ts', function () {
    return { prepareBackupDownloadService: vi.fn() }
})

vi.mock('@/server/Admin/Backups/upload.service.ts', function () {
    return {
        receiveBackupUpload: vi.fn(),
        validateBackupUploadRequest: vi.fn(),
    }
})

vi.mock('@/server/Admin/Backups/import-admission.service.ts', function () {
    return { acquireBackupImportAdmissionService: vi.fn() }
})

vi.mock('@/server/Auth/authorization.service.ts', function () {
    class AuthenticationRequiredError extends Error {}
    class PermissionDeniedError extends Error {}

    return {
        AuthenticationRequiredError,
        PermissionDeniedError,
        requirePermissionService: vi.fn(),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

vi.mock('@/server/RateLimit/rateLimit.service.ts', function () {
    class RateLimitError extends Error {
        readonly = 30
    }

    return { enforceRateLimit: vi.fn(), RateLimitError }
})

vi.mock('@/server/Request/sameOrigin.service.ts', function () {
    class MockSameOriginRequestError extends Error {}

    return {
        assertSameOriginRequest: vi.fn(),
        SameOriginRequestError: MockSameOriginRequestError,
    }
})

const mockedRm = rm as Mock<typeof rm>
const mockedStandaloneAudit = writeStandaloneAuditLogService as Mock<
    typeof writeStandaloneAuditLogService
>
const mockedPrepareUploadedBackupImport = prepareUploadedBackupImport as Mock<
    typeof prepareUploadedBackupImport
>
const mockedCreateManualBackup = createManualBackupForDownloadService as Mock<
    typeof createManualBackupForDownloadService
>
const mockedGetBackupRunById = getBackupRunById as Mock<typeof getBackupRunById>
const mockedRegisterImportedBackup = registerImportedBackupService as Mock<
    typeof registerImportedBackupService
>
const mockedPrepareDownload = prepareBackupDownloadService as Mock<
    typeof prepareBackupDownloadService
>
const mockedReceiveBackupUpload = receiveBackupUpload as Mock<
    typeof receiveBackupUpload
>
const mockedRequirePermission = requirePermissionService as Mock<
    typeof requirePermissionService
>
const mockedValidateUpload = validateBackupUploadRequest as Mock<
    typeof validateBackupUploadRequest
>
const mockedAcquireAdmission = acquireBackupImportAdmissionService as Mock<
    typeof acquireBackupImportAdmissionService
>
const mockedLogError = logError as Mock<typeof logError>
const mockedEnforceRateLimit = enforceRateLimit as Mock<typeof enforceRateLimit>
const mockedAssertSameOrigin = assertSameOriginRequest as Mock<
    typeof assertSameOriginRequest
>

describe('Backup-API-Routen', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        importState.published = false
        mockedValidateUpload.mockReturnValue(123)
        mockedAcquireAdmission.mockResolvedValue(admission)
        mockedRegisterImportedBackup.mockImplementation(
            async function (_input, publishArchive) {
                await publishArchive()
                return { runId: 'run-id', auditReceipt: auditMocks.receipt }
            },
        )
        mockedEnforceRateLimit.mockResolvedValue(undefined)
        mockedRequirePermission.mockResolvedValue({
            userId: '00000000-0000-4000-8000-000000000001',
            permissionKeys: ['admin.backups'],
        })
        mockedAssertSameOrigin.mockReturnValue(undefined)
        mockedPrepareDownload.mockImplementation(async (input) => ({
            fileName: input.fileName,
            fileSize: input.fileSize ?? 123,
            createBody: downloadMocks.createBody,
            dispose: downloadMocks.dispose,
        }))
    })

    it('cleans up the upload when database registration fails', async function () {
        const dispose = vi.fn(async function () {})
        mockedReceiveBackupUpload.mockResolvedValue({
            dispose,
            filePath: 'C:\\Temp\\upload.partial',
        })
        mockedPrepareUploadedBackupImport.mockResolvedValue({
            checksumSha256: 'checksum',
            fileName: 'import-safe.tar',
            fileSize: 123,
            includesStorage: false,
            publish: importMocks.publish,
            dispose: importMocks.dispose,
        })
        mockedRegisterImportedBackup.mockRejectedValue(
            new Error('database unavailable'),
        )

        const response = await handleBackupImport({
            request: new Request('https://app.example.test/import', {
                method: 'POST',
            }),
        })

        expect(response.status).toBe(500)
        expect(mockedPrepareUploadedBackupImport).toHaveBeenCalledWith(
            'C:\\Temp\\upload.partial',
            admission,
        )
        expect(mockedRegisterImportedBackup).toHaveBeenCalledWith(
            {
                checksumSha256: 'checksum',
                fileName: 'import-safe.tar',
                fileSize: 123,
                includesStorage: false,
                userId: '00000000-0000-4000-8000-000000000001',
            },
            expect.any(Function),
        )
        expect(importMocks.dispose).toHaveBeenCalledTimes(1)
        expect(mockedPrepareDownload).not.toHaveBeenCalled()
        expect(mockedRm).not.toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(mockedStandaloneAudit).not.toHaveBeenCalled()
    })

    it('lässt fehlgeschlagenes Temp-Cleanup keinen erfolgreichen Import überschreiben', async function () {
        const disposeError = new Error('temporary file is locked')
        const dispose = vi.fn(async function () {
            throw disposeError
        })
        mockedReceiveBackupUpload.mockResolvedValue({
            dispose,
            filePath: 'C:\\Temp\\upload.partial',
        })
        mockedPrepareUploadedBackupImport.mockResolvedValue({
            checksumSha256: 'checksum',
            fileName: 'import-safe.tar',
            fileSize: 123,
            includesStorage: false,
            publish: importMocks.publish,
            dispose: importMocks.dispose,
        })
        mockedRegisterImportedBackup.mockResolvedValue({
            runId: 'run-id',
            auditReceipt: auditMocks.receipt,
        })

        const response = await handleBackupImport({
            request: new Request('https://app.example.test/import', {
                method: 'POST',
            }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            runId: 'run-id',
        })
        expect(mockedLogError).toHaveBeenCalledWith(
            'backup.import.upload_cleanup_failed',
            disposeError,
        )
        expect(mockedRm).not.toHaveBeenCalled()
    })

    it('weist einen Import ohne Same-Origin vor Queue, Auth und Upload ab', async function () {
        mockedAssertSameOrigin.mockImplementation(function () {
            throw new SameOriginRequestError()
        })

        const response = await handleBackupImport({
            request: new Request('https://evil.example.test/import', {
                method: 'POST',
            }),
        })

        expect(response.status).toBe(403)
        expect(mockedEnforceRateLimit).not.toHaveBeenCalled()
        expect(mockedRequirePermission).not.toHaveBeenCalled()
        expect(mockedValidateUpload).not.toHaveBeenCalled()
        expect(mockedAcquireAdmission).not.toHaveBeenCalled()
        expect(mockedReceiveBackupUpload).not.toHaveBeenCalled()
    })

    it('prüft Same-Origin auch vor einem manuellen Backup-Download', async function () {
        mockedAssertSameOrigin.mockImplementation(function () {
            throw new SameOriginRequestError()
        })

        const response = await handleBackupDownload({
            request: new Request('https://evil.example.test/download', {
                method: 'POST',
            }),
        })

        expect(response.status).toBe(403)
        expect(mockedCreateManualBackup).not.toHaveBeenCalled()
    })

    it.each([null, 'respond-async', 'wait=10'])(
        'bestätigt die manuelle Erstellung immer mit 202 und Run-Verweis (Prefer: %s)',
        async function (preference) {
            mockedCreateManualBackup.mockResolvedValue({
                success: true,
                runId: '00000000-0000-4000-8000-000000000002',
            })
            const response = await handleBackupDownload({
                request: new Request('https://app.example.test/download', {
                    method: 'POST',
                    headers: preference ? { Prefer: preference } : undefined,
                }),
            })

            expect(response.status).toBe(202)
            expect(response.headers.get('preference-applied')).toBeNull()
            expect(response.headers.get('location')).toBe(
                '/api/admin/backups/00000000-0000-4000-8000-000000000002',
            )
            expect(await response.json()).toEqual({
                success: true,
                backupId: '00000000-0000-4000-8000-000000000002',
            })
            expect(mockedCreateManualBackup).toHaveBeenCalledWith(
                '00000000-0000-4000-8000-000000000001',
            )
            expect(mockedStandaloneAudit).not.toHaveBeenCalled()
            expect(mockedGetBackupRunById).not.toHaveBeenCalled()
            expect(mockedPrepareDownload).not.toHaveBeenCalled()
        },
    )

    it('überträgt einen HTTP-Abbruch nach Annahme nicht an den Queue-Job', async function () {
        const controller = new AbortController()
        mockedCreateManualBackup.mockImplementationOnce(async function () {
            controller.abort()
            return {
                success: true,
                runId: '00000000-0000-4000-8000-000000000002',
            }
        })
        const response = await handleBackupDownload({
            request: new Request('https://app.example.test/download', {
                method: 'POST',
                signal: controller.signal,
            }),
        })
        expect(controller.signal.aborted).toBe(true)
        expect(response.status).toBe(202)
        expect(mockedCreateManualBackup.mock.calls).toEqual([
            ['00000000-0000-4000-8000-000000000001'],
        ])
        expect(mockedPrepareDownload).not.toHaveBeenCalled()
    })

    it('liefert bei Annahmefehler eine sichere Fehlermeldung ohne Run-Verweis', async function () {
        mockedCreateManualBackup.mockRejectedValueOnce(
            new Error('synthetic private queue or audit failure'),
        )
        const response = await handleBackupDownload({
            request: new Request('https://app.example.test/download', {
                method: 'POST',
            }),
        })
        expect(response.status).toBe(500)
        expect(response.headers.get('location')).toBeNull()
        expect(await response.json()).toEqual({
            success: false,
            error: 'Das Backup konnte nicht erstellt werden.',
        })
        expect(mockedPrepareDownload).not.toHaveBeenCalled()
    })

    it('behält eine erfolgreiche Annahme auch bei einem späteren Response-Renderfehler', async function () {
        mockedCreateManualBackup.mockResolvedValueOnce({
            success: true,
            runId: '00000000-0000-4000-8000-000000000002',
        })
        const renderResponse = vi.spyOn(Response, 'json')
        renderResponse.mockImplementationOnce(function () {
            throw new Error('synthetic private response failure')
        })
        try {
            const response = await handleBackupDownload({
                request: new Request('https://app.example.test/download', {
                    method: 'POST',
                }),
            })
            expect(response.status).toBe(500)
            expect(await response.json()).toEqual({
                success: false,
                error: 'Das Backup konnte nicht erstellt werden.',
            })
            expect(mockedCreateManualBackup).toHaveBeenCalledTimes(1)
            expect(mockedRm).not.toHaveBeenCalled()
            expect(mockedPrepareDownload).not.toHaveBeenCalled()
        } finally {
            renderResponse.mockRestore()
        }
    })

    it('lehnt eine ungültige Backup-ID vor dem Datenbankzugriff ab', async function () {
        const response = await handleStoredBackupDownload({
            request: new Request(
                'https://app.example.test/api/admin/backups/synthetic',
            ),
            params: { backupId: 'not-a-uuid' },
        })

        expect(response.status).toBe(400)
        expect(mockedGetBackupRunById).not.toHaveBeenCalled()
    })

    it.each([
        {
            name: 'Import',
            invoke: () =>
                handleBackupImport({
                    request: new Request('https://app.example.test/import', {
                        method: 'POST',
                    }),
                }),
        },
        {
            name: 'Backup-Erstellung',
            invoke: () =>
                handleBackupDownload({
                    request: new Request('https://app.example.test/download', {
                        method: 'POST',
                    }),
                }),
        },
        {
            name: 'Archivdownload',
            invoke: () =>
                handleStoredBackupDownload({
                    request: new Request(
                        'https://app.example.test/api/admin/backups/synthetic',
                    ),
                    params: {
                        backupId: '00000000-0000-4000-8000-000000000002',
                    },
                }),
        },
    ])(
        'stoppt $name bei aktivem Wartungsmodus vor Upload, Job und Datei',
        async function ({ invoke }) {
            const error = new MaintenanceModeError()
            mockedRequirePermission.mockRejectedValue(error)

            const response = await invoke()

            expect(response.status).toBe(503)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(await response.json()).toEqual({
                success: false,
                error: error.message,
            })
            expect(mockedValidateUpload).not.toHaveBeenCalled()
            expect(mockedAcquireAdmission).not.toHaveBeenCalled()
            expect(mockedReceiveBackupUpload).not.toHaveBeenCalled()
            expect(mockedPrepareUploadedBackupImport).not.toHaveBeenCalled()
            expect(mockedRegisterImportedBackup).not.toHaveBeenCalled()
            expect(mockedCreateManualBackup).not.toHaveBeenCalled()
            expect(mockedGetBackupRunById).not.toHaveBeenCalled()
            expect(mockedPrepareDownload).not.toHaveBeenCalled()
            expect(mockedStandaloneAudit).not.toHaveBeenCalled()
            expect(mockedLogError).not.toHaveBeenCalled()
            expect(mockedRm).not.toHaveBeenCalled()
        },
    )

    it.each(['audit-publish', 'retention'])(
        'löscht bei %s-Fehler nach Importcommit kein bestätigtes Archiv',
        async function (failure) {
            const uploadDispose = vi.fn(async function () {})
            mockedReceiveBackupUpload.mockResolvedValue({
                filePath: 'C:/Temp/upload.partial',
                dispose: uploadDispose,
            })
            mockedPrepareUploadedBackupImport.mockResolvedValue({
                fileName: 'import-safe.tar',
                fileSize: 123,
                checksumSha256: 'a'.repeat(64),
                includesStorage: false,
                publish: importMocks.publish,
                dispose: importMocks.dispose,
            })
            if (failure === 'audit-publish') auditMocks.state.failPublish = true
            else {
                const retention = applyBackupRetentionBestEffort as Mock<
                    typeof applyBackupRetentionBestEffort
                >
                retention.mockRejectedValueOnce(
                    new Error('synthetic retention publication failed'),
                )
            }

            const response = await handleBackupImport({
                request: new Request('https://app.example.test/import', {
                    method: 'POST',
                }),
            })

            expect(response.status).toBe(500)
            expect(importState.published).toBe(true)
            expect(importMocks.dispose).not.toHaveBeenCalled()
            expect(mockedRm).not.toHaveBeenCalled()
            expect(uploadDispose).toHaveBeenCalledTimes(1)
        },
    )

    it('publiziert den bestätigten Importbeleg und schützt nur dessen Run vor Retention', async function () {
        mockedReceiveBackupUpload.mockResolvedValue({
            filePath: 'C:/Temp/upload.partial',
            dispose: vi.fn(async function () {}),
        })
        mockedPrepareUploadedBackupImport.mockResolvedValue({
            fileName: 'import-safe.tar',
            fileSize: 123,
            checksumSha256: 'a'.repeat(64),
            includesStorage: false,
            publish: importMocks.publish,
            dispose: importMocks.dispose,
        })

        const response = await handleBackupImport({
            request: new Request('https://app.example.test/import', {
                method: 'POST',
            }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            runId: 'run-id',
        })
        expect(auditMocks.publish).toHaveBeenCalledWith(auditMocks.receipt)
        expect(applyBackupRetentionBestEffort).toHaveBeenCalledWith(
            new Set(['run-id']),
        )
        expect(importMocks.dispose).not.toHaveBeenCalled()
    })

    it('liefert bei Auditfehler keine gespeicherten Archivbytes aus', async function () {
        const backupId = '019f5b07-80e2-7000-8000-000000000002'
        mockedGetBackupRunById.mockResolvedValue({
            id: backupId,
            trigger: 'manual',
            status: 'completed',
            targetKey: 'local',
            fileName: 'backup-safe.tanstack-backup.enc',
            fileSize: 23,
            includesStorage: false,
            checksumSha256: 'a'.repeat(64),
            errorMessage: null,
            createdByUserId: null,
            startedAt: new Date('2026-09-06T10:00:00.000Z'),
            completedAt: new Date('2026-09-06T10:01:00.000Z'),
        })
        mockedStandaloneAudit.mockRejectedValueOnce(
            new Error('synthetic mandatory audit failed'),
        )

        const response = await handleStoredBackupDownload({
            request: new Request(
                'https://app.example.test/api/admin/backups/' + backupId,
            ),
            params: { backupId },
        })

        expect(response.status).toBe(500)
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        )
        const body = await response.text()
        expect(body).not.toContain('synthetic-archive-bytes')
        expect(body).not.toContain('synthetic mandatory audit failed')
        expect(mockedStandaloneAudit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'admin.backups.downloaded',
                actorUserId: '00000000-0000-4000-8000-000000000001',
                newValues: { backupRunId: backupId },
            }),
        )
        expect(mockedRm).not.toHaveBeenCalled()
        expect(downloadMocks.createBody).not.toHaveBeenCalled()
        expect(downloadMocks.dispose).toHaveBeenCalledTimes(1)
    })
    it('liefert bei einem abgelehnten gespeicherten Archiv keine Bytes und schreibt keinen Download-Audit', async function () {
        const backupId = '019f5b07-80e2-7000-8000-000000000002'
        mockedGetBackupRunById.mockResolvedValue({
            id: backupId,
            trigger: 'manual',
            status: 'completed',
            targetKey: 'local',
            fileName: 'backup-safe.tanstack-backup.enc',
            fileSize: 123,
            includesStorage: false,
            checksumSha256: 'a'.repeat(64),
            errorMessage: null,
            createdByUserId: null,
            startedAt: new Date('2026-09-06T10:00:00.000Z'),
            completedAt: new Date('2026-09-06T10:01:00.000Z'),
        })
        mockedPrepareDownload.mockRejectedValueOnce(
            new BackupApiError(409, 'Unverschlüsseltes Backupformat.'),
        )
        const request = new Request('https://app.example.test/download', {
            method: 'GET',
        })
        const response = await handleStoredBackupDownload({
            request,
            params: { backupId },
        })

        expect(response.status).toBe(409)
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        )
        expect(mockedPrepareDownload).toHaveBeenCalledWith({
            fileName: 'backup-safe.tanstack-backup.enc',
            fileSize: 123,
            checksumSha256: 'a'.repeat(64),
            signal: request.signal,
        })
        expect(mockedStandaloneAudit).not.toHaveBeenCalled()
        expect(downloadMocks.createBody).not.toHaveBeenCalled()
        expect(downloadMocks.dispose).not.toHaveBeenCalled()
    })
})
