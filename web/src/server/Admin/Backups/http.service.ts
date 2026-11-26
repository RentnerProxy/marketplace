import type { BackupApiErrorStatus } from '@/server/Admin/Backups/Types/backup-service.types.ts'
import { BackupImportError } from './backup.errors.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from '@/server/Auth/authorization.errors.ts'
import { logError } from '@/server/Logging/logger.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { RateLimitError } from '@/server/RateLimit/rateLimit.service.ts'
import { SameOriginRequestError } from '@/server/Request/sameOrigin.service.ts'
import {
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_IMPORT_LIMITS,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'

export class BackupApiError extends Error {
    readonly status: BackupApiErrorStatus

    constructor(
        status: BackupApiErrorStatus,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options)
        this.name = 'BackupApiError'
        this.status = status
    }
}

function createErrorResponse(
    message: string,
    status: number,
    headers?: HeadersInit,
) {
    return Response.json(
        { success: false, error: message },
        { status, headers },
    )
}

export function createBackupApiErrorResponse(
    error: unknown,
    event: string,
    fallbackMessage: string,
) {
    if (error instanceof BackupImportError) {
        return createErrorResponse(error.message, error.status, {
            'cache-control': 'private, no-store',
            ...(error.status === 429
                ? {
                      'retry-after': String(
                          BACKUP_IMPORT_LIMITS.retryAfterSeconds,
                      ),
                  }
                : {}),
        })
    }
    if (error instanceof RateLimitError) {
        return createErrorResponse(error.message, 429, {
            'retry-after': String(error.retryAfterSeconds),
        })
    }

    if (error instanceof AuthenticationRequiredError) {
        return createErrorResponse(error.message, 401)
    }

    if (
        error instanceof PermissionDeniedError ||
        error instanceof SameOriginRequestError
    ) {
        return createErrorResponse(error.message, 403)
    }

    if (error instanceof MaintenanceModeError) {
        return createErrorResponse(error.message, 503, {
            'cache-control': 'private, no-store',
        })
    }

    if (error instanceof BackupApiError) {
        if (error.status >= 500) {
            logError(event, error.cause ?? error)
        }

        return createErrorResponse(error.message, error.status)
    }

    logError(event, error)
    return createErrorResponse(fallbackMessage, 500)
}

export function createBackupDownloadHeaders(
    fileName: string,
    fileSize: number,
) {
    const leafName = fileName.split(/[\\/]/).at(-1) ?? ''
    const sanitizedName = leafName
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 180)
    const safeFileName = sanitizedName || `backup${BACKUP_ARCHIVE_EXTENSION}`
    const encodedFileName = encodeURIComponent(safeFileName).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )

    return {
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodedFileName}`,
        'content-length': String(fileSize),
        'content-type': BACKUP_UPLOAD_CONTENT_TYPE,
        'x-content-type-options': 'nosniff',
    }
}
