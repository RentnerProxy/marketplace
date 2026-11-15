import type { SetupAccessStore } from './Types/setup-access.types.ts'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS } from '@/config/security.config.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'

const SETUP_ACCESS_KEY =
    'rentnerproxy-marketplace:system-bootstrap:first-super-user-access'
const SETUP_ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function hashSetupAccessToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
}

export async function createFirstSuperUserSetupAccessService(
    store: SetupAccessStore = getValkeyConnection(),
) {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashSetupAccessToken(token)

    await store.set(
        SETUP_ACCESS_KEY,
        tokenHash,
        'EX',
        FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS,
    )

    return token
}

export async function createFirstSuperUserSetupAccessIfMissingService(
    store: SetupAccessStore = getValkeyConnection(),
) {
    const token = randomBytes(32).toString('base64url')
    const result = await store.set(
        SETUP_ACCESS_KEY,
        hashSetupAccessToken(token),
        'EX',
        FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS,
        'NX',
    )

    return result === 'OK' ? token : null
}

export async function hasValidFirstSuperUserSetupAccessService(
    providedToken: string,
    store: SetupAccessStore = getValkeyConnection(),
) {
    if (!SETUP_ACCESS_TOKEN_PATTERN.test(providedToken)) {
        return false
    }

    const expectedTokenHash = await store.get(SETUP_ACCESS_KEY)

    if (!expectedTokenHash || !/^[a-f0-9]{64}$/.test(expectedTokenHash)) {
        return false
    }

    const providedHash = Buffer.from(hashSetupAccessToken(providedToken), 'hex')
    const expectedHash = Buffer.from(expectedTokenHash, 'hex')

    return timingSafeEqual(providedHash, expectedHash)
}

export async function clearFirstSuperUserSetupAccessService(
    store: SetupAccessStore = getValkeyConnection(),
) {
    await store.del(SETUP_ACCESS_KEY)
}
