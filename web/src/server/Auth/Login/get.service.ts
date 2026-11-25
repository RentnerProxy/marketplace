import { db } from '@/db'
import { trustedDevices } from '@/db/schema.ts'
import { and, eq } from 'drizzle-orm'
import { getCookie } from '@tanstack/react-start/server'
import { TRUSTED_DEVICE_COOKIE_NAME } from '@/config/session.config.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'

export async function hasTrustedDevice(userId: string) {
    const trustedDeviceToken = getCookie(TRUSTED_DEVICE_COOKIE_NAME)

    if (!trustedDeviceToken) {
        return false
    }

    const trustedDeviceTokenHash = await createTokenHash(trustedDeviceToken)
    const result = await db
        .select({ expiresAt: trustedDevices.expiresAt })
        .from(trustedDevices)
        .where(
            and(
                eq(trustedDevices.deviceTokenHash, trustedDeviceTokenHash),
                eq(trustedDevices.userId, userId),
            ),
        )
        .limit(1)

    const trustedDevice = result.at(0)

    return Boolean(trustedDevice && new Date() <= trustedDevice.expiresAt)
}
