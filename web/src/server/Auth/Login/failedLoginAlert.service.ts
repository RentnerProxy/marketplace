import type { FailedLoginUser } from '../Types/login-alert.types.ts'
import type { ClientRequestMeta } from '@/lib/Request/Types/client-request-meta.types.ts'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema.ts'
import { getClientRequestMeta } from '@/lib/Request/clientRequestMeta.ts'

import { logWarnError } from '@/server/Logging/logger.ts'
import { enqueueFailedLoginAlertMail } from '@/server/Queues/mail.queue.ts'

async function notifyUserAboutFailedLogin(
    user: FailedLoginUser,
    meta: ClientRequestMeta,
): Promise<void> {
    try {
        const mapsLink = meta.location
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.location)}`
            : null

        await enqueueFailedLoginAlertMail({
            to: user.email,
            username: user.username,
            ip: meta.ip,
            location: meta.location,
            device: meta.device,
            browser: meta.browser,
            attemptedAt: new Intl.DateTimeFormat('de-DE', {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'Europe/Berlin',
            }).format(new Date()),
            mapsLink,
        })
    } catch (error) {
        logWarnError('auth.failed_login_alert.unavailable', error)
    }
}

export async function notifyExistingUserAboutFailedLogin(
    username: string,
): Promise<void> {
    try {
        const [user, meta] = await Promise.all([
            db
                .select({
                    email: users.email,
                    username: users.username,
                })
                .from(users)
                .where(
                    and(
                        eq(users.username, username),
                        eq(users.isActive, true),
                        eq(users.isDeleted, false),
                    ),
                )
                .limit(1)
                .then((rows) => rows.at(0)),
            getClientRequestMeta(),
        ])

        if (user) {
            // Die Queue-Laufzeit darf nicht verraten, ob das Konto existiert; der Helfer behandelt Queuefehler selbst.
            void notifyUserAboutFailedLogin(user, meta)
        }
    } catch (error) {
        logWarnError('auth.failed_login_alert.user_lookup_unavailable', error)
    }
}
