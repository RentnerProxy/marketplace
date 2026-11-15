import type { PendingMaintenanceExtensionRequest } from './Types/maintenance.types.ts'
import { z } from 'zod'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'

const PENDING_REQUEST_KEY = 'rentnerproxy-marketplace:maintenance:extension-request'
const PENDING_REQUEST_TTL_SECONDS = 24 * 60 * 60
const storedPendingMaintenanceExtensionRequestSchema = z
    .object({
        id: z.uuid(),
        userId: z.uuid(),
        username: z.string().min(1),
        reason: z.string().min(10).max(500),
        requestedAt: z.iso.datetime(),
    })
    .strict()

function parsePendingRequest(value: string | null) {
    if (!value) {
        return null
    }

    try {
        const parsed = storedPendingMaintenanceExtensionRequestSchema.safeParse(
            JSON.parse(value),
        )

        if (!parsed.success) {
            return null
        }

        return {
            ...parsed.data,
            requestedAt: new Date(parsed.data.requestedAt),
        }
    } catch {
        return null
    }
}

export async function getPendingMaintenanceExtensionRequest() {
    return parsePendingRequest(
        await getValkeyConnection().get(PENDING_REQUEST_KEY),
    )
}

export async function clearPendingMaintenanceExtensionRequest(
    requestId?: string,
) {
    const valkey = getValkeyConnection()
    const serializedRequest = await valkey.get(PENDING_REQUEST_KEY)
    const pendingRequest = parsePendingRequest(serializedRequest)

    if (
        !pendingRequest ||
        !serializedRequest ||
        (requestId && pendingRequest.id !== requestId)
    ) {
        return null
    }

    const deleted = await valkey.eval(
        `if server.call('get', KEYS[1]) == ARGV[1] then
            return server.call('del', KEYS[1])
        end
        return 0`,
        1,
        PENDING_REQUEST_KEY,
        serializedRequest,
    )

    return deleted === 1 ? pendingRequest : null
}

export async function setPendingMaintenanceExtensionRequest(
    request: PendingMaintenanceExtensionRequest,
) {
    const result = await getValkeyConnection().set(
        PENDING_REQUEST_KEY,
        JSON.stringify(request),
        'EX',
        PENDING_REQUEST_TTL_SECONDS,
        'NX',
    )

    return result === 'OK'
}
