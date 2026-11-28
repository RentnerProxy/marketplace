import { describe, expect, it } from 'bun:test'
import { BackupImportError } from '@/server/Admin/Backups/backup.errors.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from '@/server/Auth/authorization.errors.ts'
import { RateLimitError } from '@/server/RateLimit/rateLimit.service.ts'
import { SameOriginRequestError } from '@/server/Request/sameOrigin.service.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import {
    BackupApiError,
    createBackupApiErrorResponse,
    createBackupDownloadHeaders,
} from '@/server/Admin/Backups/http.service.ts'

async function getErrorBody(response: Response) {
    return (await response.json()) as {
        success: boolean
        error: string
    }
}

describe('Backup-HTTP-Helfer', function () {
    it.each([408, 429, 503, 507] as const)(
        'liefert den Importstatus %s privat und ohne interne Eigenschaften',
        async function (status) {
            const error = Object.assign(
                new BackupImportError(status, 'Sichere Importmeldung.'),
                {
                    cause: new Error('private-storage-path'),
                    privatePath: '/private/archive',
                },
            )
            const response = createBackupApiErrorResponse(
                error,
                'backup.test',
                'Fallback',
            )
            expect(response.status).toBe(status)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(response.headers.get('retry-after')).toBe(
                status === 429 ? '5' : null,
            )
            expect(await getErrorBody(response)).toEqual({
                success: false,
                error: 'Sichere Importmeldung.',
            })
        },
    )
    it('erzeugt einen header-sicheren Download-Dateinamen', function () {
        const headers = createBackupDownloadHeaders(
            '../backup.tar"\r\nX-Injected: yes',
            42,
        )

        expect(headers['content-disposition']).toBe(
            'attachment; filename="backup.tar___X-Injected__yes"; filename*=UTF-8\'\'backup.tar___X-Injected__yes',
        )
        expect(headers['content-disposition']).not.toMatch(/[\r\n]/)
        expect(headers['content-length']).toBe('42')
        expect(headers['content-type']).toBe('application/octet-stream')
        expect(headers['cache-control']).toBe('private, no-store')
        expect(headers['x-content-type-options']).toBe('nosniff')
    })

    it('setzt bei leeren oder reinen Pfad-Dateinamen einen sicheren Fallback', function () {
        const headers = createBackupDownloadHeaders('../../', 0)

        expect(headers['content-disposition']).toContain(
            'filename="backup.enc"',
        )
    })

    it('liefert Rate-Limits mit Retry-After als 429 aus', async function () {
        const response = createBackupApiErrorResponse(
            new RateLimitError(75),
            'backup.test',
            'Fallback',
        )

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('75')
        expect((await getErrorBody(response)).error).toContain('2 Minuten')
    })

    it.each([
        [new AuthenticationRequiredError(), 401],
        [new PermissionDeniedError(), 403],
        [new SameOriginRequestError(), 403],
        [new BackupApiError(400, 'Ungültiger Upload.'), 400],
    ])(
        'ordnet erwartete API-Fehler korrekt zu',
        async function (error, status) {
            const response = createBackupApiErrorResponse(
                error,
                'backup.test',
                'Fallback',
            )

            expect(response.status).toBe(status)
            expect((await getErrorBody(response)).error).toBe(error.message)
        },
    )

    it('liefert Wartungsblockaden als nicht speicherbare private 503-Antwort', async function () {
        const error = new MaintenanceModeError()
        const response = createBackupApiErrorResponse(
            error,
            'backup.test',
            'Fallback',
        )

        expect(response.status).toBe(503)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(await getErrorBody(response)).toEqual({
            success: false,
            error: error.message,
        })
    })
})
