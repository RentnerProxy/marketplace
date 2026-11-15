import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import { z } from 'zod'
import {
    getPermissionForRoute,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'
import type {
    RestoreReturnAccess,
    RestoreReturnRecord,
} from '@/lib/Restore/Types/restore.types.ts'

const RESTORE_RETURN_PATH_STORAGE_KEY = 'rentnerproxy-marketplace:restore-return-path:v2'
const RESTORE_RETURN_PATH_MAX_AGE_MS = 24 * 60 * 60_000
const preRestoreUserIdSchema = z.uuidv7()
const restoreReturnRecordSchema = z.object({
    version: z.literal(2),
    path: z.string(),
    preRestoreUserId: preRestoreUserIdSchema,
    savedAt: z.number().int().positive(),
})

export function normalizePreRestoreUserId(value: unknown) {
    const result = preRestoreUserIdSchema.safeParse(value)
    return result.success ? result.data : null
}

function decodePathname(pathname: string) {
    let decodedPathname = pathname

    for (let index = 0; index < 4; index += 1) {
        const nextPathname = decodeURIComponent(decodedPathname)

        if (nextPathname === decodedPathname) {
            return decodedPathname
        }

        decodedPathname = nextPathname
    }

    return decodedPathname
}

function getBrowserOrigin() {
    return typeof window === 'undefined'
        ? 'http://localhost'
        : window.location.origin
}

export function normalizeRestoreReturnPath(value: unknown) {
    if (
        typeof value !== 'string' ||
        value !== value.trim() ||
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.includes('\\') ||
        hasControlCharacters(value)
    ) {
        return null
    }

    try {
        const origin = getBrowserOrigin()
        const url = new URL(value, origin)

        if (url.origin !== origin) {
            return null
        }

        const decodedPathname = decodePathname(url.pathname)

        if (
            hasControlCharacters(decodedPathname) ||
            decodedPathname.includes('\\') ||
            decodedPathname.startsWith('//') ||
            decodedPathname === '/update-in-progress' ||
            decodedPathname.startsWith('/update-in-progress/') ||
            decodedPathname === '/api' ||
            decodedPathname.startsWith('/api/')
        ) {
            return null
        }

        return `${url.pathname}${url.search}${url.hash}`
    } catch {
        return null
    }
}

function parseRestoreReturnRecord(value: string | null) {
    if (!value) {
        return null
    }

    try {
        const result = restoreReturnRecordSchema.safeParse(JSON.parse(value))
        if (!result.success) return null
        const parsed = result.data
        const path = normalizeRestoreReturnPath(parsed.path)
        const preRestoreUserId = normalizePreRestoreUserId(
            parsed.preRestoreUserId,
        )

        if (
            !path ||
            !preRestoreUserId ||
            Date.now() - parsed.savedAt > RESTORE_RETURN_PATH_MAX_AGE_MS ||
            parsed.savedAt - Date.now() > 60_000
        ) {
            return null
        }

        return {
            version: 2 as const,
            path,
            preRestoreUserId,
            savedAt: parsed.savedAt,
        }
    } catch {
        return null
    }
}

function readRestoreReturnRecord() {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        const rawRecord = window.sessionStorage.getItem(
            RESTORE_RETURN_PATH_STORAGE_KEY,
        )
        const record = parseRestoreReturnRecord(rawRecord)

        if (rawRecord && !record) {
            window.sessionStorage.removeItem(RESTORE_RETURN_PATH_STORAGE_KEY)
        }

        return record
    } catch {
        return null
    }
}

export function rememberRestoreReturnPath(
    path: string | null,
    preRestoreUserId: string | null | undefined,
) {
    if (typeof window === 'undefined') {
        return null
    }

    const normalizedPath = normalizeRestoreReturnPath(path)
    const normalizedUserId = normalizePreRestoreUserId(preRestoreUserId)

    if (!normalizedPath || !normalizedUserId) {
        return null
    }

    const existingRecord = readRestoreReturnRecord()

    if (existingRecord?.preRestoreUserId === normalizedUserId) {
        return existingRecord.path
    }

    const record: RestoreReturnRecord = {
        version: 2,
        path: normalizedPath,
        preRestoreUserId: normalizedUserId,
        savedAt: Date.now(),
    }

    try {
        window.sessionStorage.setItem(
            RESTORE_RETURN_PATH_STORAGE_KEY,
            JSON.stringify(record),
        )
        return record.path
    } catch {
        return null
    }
}

export function getRestoreReturnPath() {
    return readRestoreReturnRecord()?.path ?? null
}

export function clearRestoreReturnPath() {
    if (typeof window === 'undefined') {
        return
    }

    try {
        window.sessionStorage.removeItem(RESTORE_RETURN_PATH_STORAGE_KEY)
    } catch (error) {
        console.error(
            'Der Restore-Rücksprung konnte nicht aus dem Session Storage entfernt werden.',
            error,
        )
    }
}

export function consumePermittedRestoreReturnPath({
    currentUserId,
    permissions,
}: RestoreReturnAccess) {
    const record = readRestoreReturnRecord()
    clearRestoreReturnPath()

    if (!record || record.preRestoreUserId !== currentUserId) {
        return null
    }

    const requiredPermission = getPermissionForRoute(record.path)

    if (
        !requiredPermission ||
        !hasPermission(permissions, requiredPermission)
    ) {
        return null
    }

    return record.path
}
