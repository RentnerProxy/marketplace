import { useEffect, useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { PendingManualBackupIntentLogicReturn } from '../Types/backup-logic.types.ts'
import type { PendingManualBackupIntent } from '../Types/backup-client.types.ts'

const PENDING_MANUAL_BACKUP_STORAGE_KEY =
    'rentnerproxy-marketplace:pending-manual-backup:v1'
const PENDING_MANUAL_BACKUP_MAX_AGE_MS = 24 * 60 * 60_000
const pendingManualBackupIntentSchema = z
    .object({
        runId: z.uuidv7(),
        userId: z.uuidv7(),
        queuedAt: z.number().int().positive().safe(),
    })
    .strict()

const listeners = new Set<() => void>()
let cachedIntent: PendingManualBackupIntent | null | undefined

function isIntentCurrent(intent: PendingManualBackupIntent) {
    const now = Date.now()

    return (
        now - intent.queuedAt <= PENDING_MANUAL_BACKUP_MAX_AGE_MS &&
        intent.queuedAt - now <= 60_000
    )
}

function parseStoredIntent(value: string | null) {
    if (!value) {
        return null
    }

    try {
        const parsed = pendingManualBackupIntentSchema.safeParse(
            JSON.parse(value),
        )

        if (!parsed.success || !isIntentCurrent(parsed.data)) {
            return null
        }

        return parsed.data
    } catch (error) {
        console.error(
            'Der ausstehende manuelle Backup-Lauf konnte nicht aus dem Session Storage gelesen werden.',
            error,
        )
        return null
    }
}

function readStoredIntent() {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        const rawIntent = window.sessionStorage.getItem(
            PENDING_MANUAL_BACKUP_STORAGE_KEY,
        )
        const intent = parseStoredIntent(rawIntent)

        if (rawIntent && !intent) {
            window.sessionStorage.removeItem(PENDING_MANUAL_BACKUP_STORAGE_KEY)
        }

        return intent
    } catch {
        return null
    }
}

export function getPendingManualBackupIntent() {
    if (cachedIntent === undefined) {
        cachedIntent = readStoredIntent()
    }

    if (cachedIntent && !isIntentCurrent(cachedIntent)) {
        cachedIntent = null

        try {
            if (typeof window === 'undefined') {
                return cachedIntent
            }

            window.sessionStorage.removeItem(PENDING_MANUAL_BACKUP_STORAGE_KEY)
        } catch (error) {
            console.error(
                'Der abgelaufene manuelle Backup-Lauf konnte nicht aus dem Session Storage entfernt werden.',
                error,
            )
        }
    }

    return cachedIntent
}

function getPendingManualBackupIntentServerSnapshot() {
    return null
}

function emit() {
    listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)

    return function unsubscribe() {
        listeners.delete(listener)
    }
}

function persistIntent(intent: PendingManualBackupIntent | null) {
    cachedIntent = intent

    if (typeof window !== 'undefined') {
        try {
            if (intent) {
                window.sessionStorage.setItem(
                    PENDING_MANUAL_BACKUP_STORAGE_KEY,
                    JSON.stringify(intent),
                )
            } else {
                window.sessionStorage.removeItem(
                    PENDING_MANUAL_BACKUP_STORAGE_KEY,
                )
            }
        } catch (error) {
            console.error(
                'Der ausstehende manuelle Backup-Lauf konnte nicht im Session Storage gespeichert werden.',
                error,
            )
        }
    }

    emit()
}

export function setPendingManualBackupIntent(input: {
    runId: string
    userId: string
}) {
    const intent = pendingManualBackupIntentSchema.safeParse({
        ...input,
        queuedAt: Date.now(),
    })

    if (!intent.success) {
        return false
    }

    persistIntent(intent.data)
    return true
}

export function clearPendingManualBackupIntent(
    expectedRunId?: string,
    expectedUserId?: string,
) {
    // Preserve the cached identity until its expiry timer can clear and notify.
    const intent =
        cachedIntent === undefined
            ? getPendingManualBackupIntent()
            : cachedIntent

    if (
        (expectedRunId && intent?.runId !== expectedRunId) ||
        (expectedUserId && intent?.userId !== expectedUserId)
    ) {
        return
    }

    persistIntent(null)
}

export default function usePendingManualBackupIntent(
    userId: string | null,
): PendingManualBackupIntentLogicReturn {
    const storedIntent = useSyncExternalStore(
        subscribe,
        getPendingManualBackupIntent,
        getPendingManualBackupIntentServerSnapshot,
    )
    const intent = storedIntent?.userId === userId ? storedIntent : null

    useEffect(() => {
        if (userId && storedIntent && storedIntent.userId !== userId) {
            clearPendingManualBackupIntent(
                storedIntent.runId,
                storedIntent.userId,
            )
        }
    }, [storedIntent, userId])

    useEffect(() => {
        if (!intent) {
            return undefined
        }

        const expiresIn = Math.max(
            0,
            intent.queuedAt + PENDING_MANUAL_BACKUP_MAX_AGE_MS - Date.now(),
        )
        const expirationTimer = window.setTimeout(function () {
            clearPendingManualBackupIntent(intent.runId, intent.userId)
        }, expiresIn + 1)

        return function () {
            window.clearTimeout(expirationTimer)
        }
    }, [intent])

    function handleSetPendingManualBackup(runId: string) {
        return userId ? setPendingManualBackupIntent({ runId, userId }) : false
    }

    return {
        state: {
            pendingManualBackupId: intent?.runId ?? null,
        },
        handler: {
            handleSetPendingManualBackup,
        },
    }
}
