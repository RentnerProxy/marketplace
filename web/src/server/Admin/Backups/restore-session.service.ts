import type { RestoreSessionSnapshot } from '@/server/Admin/Backups/Types/archive-restore.types.ts'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { sessionConfig } from '@/config/session.config.ts'
import { db } from '@/db'
import {
    passkeyChallenges,
    passwordResetTokens,
    sessions,
    trustedDevices,
    users,
} from '@/db/schema.ts'
import { logError } from '@/server/Logging/logger.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'

const RESTORE_SESSION_BINDING_KEY_PREFIX =
    'rentnerproxy-marketplace:backup:restore-session:v1:'
const restoreRunIdSchema = z.uuid()
const restoreSessionHashSchema = z.string().regex(/^[a-f\d]{64}$/i)
const consumeRestoreSessionBindingScript = `local value = server.call('get', KEYS[1])
if value then
    server.call('del', KEYS[1])
end
return value`

function getRestoreSessionBindingKey(runId: string) {
    return `${RESTORE_SESSION_BINDING_KEY_PREFIX}${restoreRunIdSchema.parse(runId)}`
}

export async function saveRestoreInitiatorSessionBindingService(
    runId: string,
    sessionHash: string,
    expiresAt: Date,
) {
    const validatedSessionHash = restoreSessionHashSchema.parse(sessionHash)
    const remainingSessionDurationMs = Math.min(
        expiresAt.getTime() - Date.now(),
        sessionConfig.idleDurationMs,
    )

    if (
        !Number.isSafeInteger(remainingSessionDurationMs) ||
        remainingSessionDurationMs <= 0
    ) {
        throw new Error(
            'Eine abgelaufene Sitzung kann keinen Restore auslösen.',
        )
    }

    const result = await getValkeyConnection().set(
        getRestoreSessionBindingKey(runId),
        validatedSessionHash,
        'PX',
        remainingSessionDurationMs,
        'NX',
    )

    if (result !== 'OK') {
        throw new Error(
            'Die initiierende Restore-Sitzung konnte nicht eindeutig gebunden werden.',
        )
    }
}

export async function consumeRestoreInitiatorSessionBindingService(
    runId: string,
) {
    let storedSessionHash: unknown

    try {
        storedSessionHash = await getValkeyConnection().eval(
            consumeRestoreSessionBindingScript,
            1,
            getRestoreSessionBindingKey(runId),
        )
    } catch (error) {
        logError('backup.restore.session_binding_read_failed', error, { runId })
        return null
    }

    if (storedSessionHash === null) {
        return null
    }

    const sessionHash = restoreSessionHashSchema.safeParse(storedSessionHash)

    if (!sessionHash.success) {
        throw new Error(
            'Die gespeicherte Restore-Sitzungsbindung ist ungültig oder nicht unterstützt.',
        )
    }

    return sessionHash.data
}

export async function deleteRestoreInitiatorSessionBindingBestEffortService(
    runId: string,
) {
    try {
        await getValkeyConnection().del(getRestoreSessionBindingKey(runId))
    } catch (error) {
        logError('backup.restore.session_binding_cleanup_failed', error, {
            runId,
        })
    }
}

export async function getRestoreInitiatorSessionService(
    userId: string,
    sessionHash: string,
) {
    const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionHash))
        .limit(1)
    const session = rows.at(0)

    if (!session || session.expiresAt <= new Date()) {
        return null
    }

    if (session.userId !== userId) {
        throw new Error(
            'Die initiierende Restore-Sitzung gehört nicht zum auslösenden Benutzer.',
        )
    }

    const activeUserRows = await db
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                eq(users.id, userId),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
            ),
        )
        .limit(1)

    if (!activeUserRows.at(0) || session.expiresAt <= new Date()) {
        return null
    }

    return session
}

export async function replaceRestoredAuthenticationStateService(
    initiatorSession: RestoreSessionSnapshot | null,
) {
    return db.transaction(async function (transaction) {
        await transaction.delete(passkeyChallenges)
        await transaction.delete(passwordResetTokens)
        await transaction.delete(trustedDevices)
        await transaction.delete(sessions)

        if (!initiatorSession || initiatorSession.expiresAt <= new Date()) {
            return false
        }

        const restoredUserRows = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.id, initiatorSession.userId),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                ),
            )
            .limit(1)

        if (
            !restoredUserRows.at(0) ||
            initiatorSession.expiresAt <= new Date()
        ) {
            return false
        }

        await transaction.insert(sessions).values(initiatorSession)
        return true
    })
}
