import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import type { CoreRuntimeHealth } from './Types/core.types.ts'
import {
    fetchLoopbackJsonService,
    parseLoopbackOriginService,
} from './loopback-client.service.ts'

const coreRuntimeHealthSchema = z
    .object({
        status: z.literal('running'),
        version: z.string().min(1).max(128),
        pid: z.number().int().positive(),
        uptimeSeconds: z.number().finite().nonnegative(),
    })
    .strict() satisfies z.ZodType<CoreRuntimeHealth>

export function getCoreRuntimeOriginService() {
    const url = parseLoopbackOriginService(
        process.env.CORE_ORIGIN?.trim() || CORE_RUNTIME.origin,
    )
    if (!url || url.protocol !== 'http:') {
        throw new Error(
            'CORE_ORIGIN muss eine lokale HTTP-Origin ohne Pfad oder Zugangsdaten sein.',
        )
    }
    return url.origin
}

export async function getCoreRuntimeHealthService(): Promise<CoreRuntimeHealth> {
    const response = await fetchLoopbackJsonService(
        getCoreRuntimeOriginService(),
        CORE_RUNTIME.healthPath,
        undefined,
        {
            timeoutMs: CORE_RUNTIME.healthTimeoutMs,
            maxResponseBytes: CORE_RUNTIME.healthMaxResponseBytes,
            responseName: 'Rust core health',
        },
    )
    return coreRuntimeHealthSchema.parse(response)
}
