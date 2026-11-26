import * as fileSystem from 'node:fs/promises'
import * as archiveFiles from '@/server/Admin/Backups/archive-files.service.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { createBackupImportTestContext } from './import-context.test.helpers.ts'

vi.mock('@/config/backup.config.ts', function () {
    return {
        BACKUP_UPLOAD_CONTENT_TYPE: 'application/octet-stream',
        BACKUP_FILE_PERMISSIONS: { file: 0o600 },
        BACKUP_LIMITS: { maxArchiveBytes: 64 },
    }
})

import {
    BACKUP_LIMITS,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'
import {
    receiveBackupUpload,
    validateBackupUploadRequest,
} from '@/server/Admin/Backups/upload.service.ts'

let testRoot = ''

function createRequest(
    body: string | null,
    options: {
        contentLength?: string
        contentType?: string | null
        signal?: AbortSignal
    } = {},
) {
    const headers = new Headers()
    if (options.contentType !== null) {
        headers.set(
            'content-type',
            options.contentType ?? BACKUP_UPLOAD_CONTENT_TYPE,
        )
    }
    if (options.contentLength !== undefined)
        headers.set('content-length', options.contentLength)
    return new Request('http://localhost/api/admin/backups/import', {
        method: 'POST',
        headers,
        body: body === null ? null : new TextEncoder().encode(body),
        signal: options.signal,
    })
}

function contextFor(request: Request, maximum = BACKUP_LIMITS.maxArchiveBytes) {
    return createBackupImportTestContext(testRoot, maximum, request.signal)
}

async function expectRejectedAndCleaned(request: Request) {
    await expect(
        receiveBackupUpload(request, contextFor(request).context),
    ).rejects.toThrow()
    await expect(readdir(testRoot)).resolves.toEqual([])
    expect((await stat(testRoot)).isDirectory()).toBe(true)
}

beforeEach(async function () {
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'backup-upload-test-'))
})

afterEach(async function () {
    const resolved = path.resolve(testRoot)
    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('backup-upload-test-')
    )
        throw new Error('unsafe_synthetic_upload_cleanup')
    await rm(resolved, { force: true, recursive: true })
})

describe('Backup-Uploadgrenzen', function () {
    it('creates the upload exclusively with private permissions from its first byte', async function () {
        const openSpy = vi.spyOn(fileSystem, 'open')
        try {
            const request = createRequest('private-backup')
            const fixture = contextFor(request)
            fixture.beforeWrite.mockImplementation(async function () {
                expect(
                    (await stat(path.join(testRoot, 'upload.partial'))).size,
                ).toBe(0)
            })
            const upload = await receiveBackupUpload(request, fixture.context)
            expect(openSpy).toHaveBeenCalledWith(upload.filePath, 'wx', 0o600)
            expect(path.dirname(upload.filePath)).toBe(testRoot)
            if (process.platform !== 'win32') {
                expect((await stat(upload.filePath)).mode & 0o777).toBe(0o600)
                expect((await stat(testRoot)).mode & 0o777).toBe(0o700)
            }
            await upload.dispose()
            expect(await readdir(testRoot)).toEqual([])
            expect((await stat(testRoot)).isDirectory()).toBe(true)
        } finally {
            openSpy.mockRestore()
        }
    })

    it('schreibt den rohen Backup-Body unverändert und räumt nur seine Datei auf', async function () {
        const request = createRequest('valid-backup')
        const fixture = contextFor(request)
        const upload = await receiveBackupUpload(request, fixture.context)
        expect(await readFile(upload.filePath, 'utf8')).toBe('valid-backup')
        expect(fixture.beforeWrite).toHaveBeenCalledWith(12)
        const retained = path.join(testRoot, 'other-owned-artifact')
        await writeFile(retained, 'retain')
        await upload.dispose()
        expect(await readdir(testRoot)).toEqual(['other-owned-artifact'])
        expect(await readFile(retained, 'utf8')).toBe('retain')
        expect(fixture.markCleanupIncomplete).not.toHaveBeenCalled()
    })

    it('writes consecutive byte views in order without including their backing bytes', async function () {
        const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 0])
        const request = new Request(
            'http://localhost/api/admin/backups/import',
            {
                method: 'POST',
                headers: { 'content-type': BACKUP_UPLOAD_CONTENT_TYPE },
                body: new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(bytes.subarray(1, 3))
                        controller.enqueue(bytes.subarray(3, 6))
                        controller.close()
                    },
                }),
            },
        )
        const fixture = contextFor(request, 5)
        const upload = await receiveBackupUpload(request, fixture.context)
        try {
            expect(await readFile(upload.filePath)).toEqual(
                Buffer.from([1, 2, 3, 4, 5]),
            )
            expect(fixture.beforeWrite.mock.calls).toEqual([[2], [3]])
        } finally {
            await upload.dispose()
        }
    })

    it('akzeptiert einen Body exakt am Archivlimit', async function () {
        const body = 'x'.repeat(BACKUP_LIMITS.maxArchiveBytes)
        const request = createRequest(body)
        const upload = await receiveBackupUpload(
            request,
            contextFor(request).context,
        )
        expect(await readFile(upload.filePath, 'utf8')).toBe(body)
        await upload.dispose()
    })

    it('liefert die geprüfte deklarierte Bytezahl vor Admission ohne Bodyverbrauch', function () {
        const request = createRequest('ä', { contentLength: '2' })
        expect(validateBackupUploadRequest(request)).toBe(2)
        expect(request.bodyUsed).toBe(false)
        expect(validateBackupUploadRequest(createRequest('body'))).toBe(null)
    })

    it('lehnt einen deklarierten übergroßen Body vor dem Temp-Upload ab', async function () {
        await expectRejectedAndCleaned(
            createRequest('valid-backup', {
                contentLength: String(BACKUP_LIMITS.maxArchiveBytes + 1),
            }),
        )
    })

    it.each(['invalid', '-1', '1.5', '+2', '9007199254740992'])(
        'lehnt eine ungültige deklarierte Bodygröße ab: %s',
        async function (contentLength) {
            const request = createRequest('valid-backup', { contentLength })
            expect(() => validateBackupUploadRequest(request)).toThrow()
            await expectRejectedAndCleaned(request)
        },
    )

    it('begrenzt auch einen Body ohne Content-Length vollständig', async function () {
        const request = createRequest(
            'x'.repeat(BACKUP_LIMITS.maxArchiveBytes + 1),
        )
        expect(request.headers.get('content-length')).toBeNull()
        await expectRejectedAndCleaned(request)
    })

    it.each(['2', '4'])(
        'verwirft einen Body, dessen tatsächliche Größe von %s abweicht',
        async function (contentLength) {
            const request = createRequest('abc', { contentLength })
            await expectRejectedAndCleaned(request)
        },
    )

    it('zählt Byte statt Zeichen und akzeptiert die genaue deklarierte Größe', async function () {
        const request = createRequest('ä', { contentLength: '2' })
        const fixture = contextFor(request, 2)
        const upload = await receiveBackupUpload(request, fixture.context)
        expect(await readFile(upload.filePath, 'utf8')).toBe('ä')
        expect(fixture.beforeWrite).toHaveBeenCalledWith(2)
        await upload.dispose()
    })

    it('begrenzt die tatsächlichen Bytes auf das kleinere Admissionbudget', async function () {
        const request = createRequest('abcd')
        const fixture = contextFor(request, 3)
        await expect(
            receiveBackupUpload(request, fixture.context),
        ).rejects.toThrow('Größenlimit')
        expect(fixture.beforeWrite).not.toHaveBeenCalled()
        expect(await readdir(testRoot)).toEqual([])
    })

    it('bricht die Pipeline mit dem Request ab und erhält das Admissionverzeichnis', async function () {
        const controller = new AbortController()
        const request = createRequest('valid-backup', {
            signal: controller.signal,
        })
        controller.abort()
        await expectRejectedAndCleaned(request)
    })

    it('cancels a blocked Web stream read before removing its partial upload', async function () {
        const waitingForBody = Promise.withResolvers<void>()
        const finishPull = Promise.withResolvers<void>()
        const cancel = vi.fn()
        const request = new Request(
            'http://localhost/api/admin/backups/import',
            {
                method: 'POST',
                headers: { 'content-type': BACKUP_UPLOAD_CONTENT_TYPE },
                body: new ReadableStream<Uint8Array>(
                    {
                        pull() {
                            waitingForBody.resolve()
                            return finishPull.promise
                        },
                        cancel,
                    },
                    { highWaterMark: 0 },
                ),
            },
        )
        const fixture = contextFor(request)
        const uploading = receiveBackupUpload(request, fixture.context)
        try {
            await waitingForBody.promise
            fixture.controller.abort(new Error('Upload aborted'))
            await expect(uploading).rejects.toThrow('Upload aborted')
            expect(cancel).toHaveBeenCalledTimes(1)
            expect(await readdir(testRoot)).toEqual([])
        } finally {
            finishPull.resolve()
        }
    })

    it('wartet bei Abbruch auf einen laufenden Budgetcallback vor Dateicleanup', async function () {
        const request = createRequest('valid-backup')
        const fixture = contextFor(request)
        const entered = Promise.withResolvers<void>()
        const continueBudget = Promise.withResolvers<void>()
        fixture.beforeWrite.mockImplementation(async function () {
            entered.resolve()
            await continueBudget.promise
        })
        let settled = false
        const outcome = receiveBackupUpload(request, fixture.context).then(
            () => {
                settled = true
                return null
            },
            (error: unknown) => {
                settled = true
                return error
            },
        )
        await entered.promise
        fixture.controller.abort()
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(settled).toBe(false)
        continueBudget.resolve()
        expect(await outcome).toBeInstanceOf(Error)
        expect(await readdir(testRoot)).toEqual([])
        expect(fixture.markCleanupIncomplete).not.toHaveBeenCalled()
    })

    it('stoppt vor dem ersten Diskbyte, wenn die Budgetprüfung fehlschlägt', async function () {
        const request = createRequest('valid-backup')
        const fixture = contextFor(request)
        const error = new Error('synthetic_disk_budget_exhausted')
        fixture.beforeWrite.mockRejectedValueOnce(error)
        await expect(
            receiveBackupUpload(request, fixture.context),
        ).rejects.toBe(error)
        expect(await readdir(testRoot)).toEqual([])
        expect(fixture.markCleanupIncomplete).not.toHaveBeenCalled()
    })

    it('lässt eine fremde vorhandene Uploaddatei bei EEXIST vollständig bestehen', async function () {
        const foreign = path.join(testRoot, 'upload.partial')
        await writeFile(foreign, 'foreign')
        const request = createRequest('valid-backup')
        const fixture = contextFor(request)
        const cleanupSpy = vi.spyOn(archiveFiles, 'removePathBestEffort')
        try {
            await expect(
                receiveBackupUpload(request, fixture.context),
            ).rejects.toMatchObject({ code: 'EEXIST' })
            expect(cleanupSpy).not.toHaveBeenCalled()
            expect(await readFile(foreign, 'utf8')).toBe('foreign')
        } finally {
            cleanupSpy.mockRestore()
        }
    })

    it.each(['false', 'throw'] as const)(
        'markiert nicht bestätigtes Producer-Cleanup (%s) vor der Rückgabe',
        async function (failure) {
            const request = createRequest('x'.repeat(65))
            const fixture = contextFor(request)
            const cleanupSpy = vi.spyOn(archiveFiles, 'removePathBestEffort')
            if (failure === 'false') cleanupSpy.mockResolvedValue(false)
            else
                cleanupSpy.mockRejectedValue(
                    new Error('synthetic_cleanup_failure'),
                )
            try {
                await expect(
                    receiveBackupUpload(request, fixture.context),
                ).rejects.toBeInstanceOf(AggregateError)
                expect(fixture.markCleanupIncomplete).toHaveBeenCalledTimes(1)
                expect(
                    (
                        await stat(path.join(testRoot, 'upload.partial'))
                    ).isFile(),
                ).toBe(true)
                expect((await stat(testRoot)).isDirectory()).toBe(true)
            } finally {
                cleanupSpy.mockRestore()
            }
        },
    )

    it('lässt dispose bei fehlgeschlagenem Cleanup werfen und markiert den Context', async function () {
        const request = createRequest('valid-backup')
        const fixture = contextFor(request)
        const upload = await receiveBackupUpload(request, fixture.context)
        const cleanupSpy = vi
            .spyOn(archiveFiles, 'removePathBestEffort')
            .mockResolvedValue(false)
        try {
            await expect(upload.dispose()).rejects.toThrow()
            expect(fixture.markCleanupIncomplete).toHaveBeenCalledTimes(1)
            expect(await readFile(upload.filePath, 'utf8')).toBe('valid-backup')
        } finally {
            cleanupSpy.mockRestore()
        }
    })

    it('lehnt einen fehlenden Request-Body ab', async function () {
        await expectRejectedAndCleaned(createRequest(null))
    })

    it('lehnt einen fehlenden Content-Type ab', async function () {
        await expectRejectedAndCleaned(
            createRequest('valid-backup', { contentType: null }),
        )
    })

    it('lehnt den alten Multipart-Vertrag ab', async function () {
        await expectRejectedAndCleaned(
            createRequest('legacy-body', {
                contentType: 'multipart/form-data; boundary=legacy',
            }),
        )
    })
})
