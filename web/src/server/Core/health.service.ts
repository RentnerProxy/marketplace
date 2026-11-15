/* eslint-disable no-await-in-loop -- Health response chunks must be read sequentially within a fixed byte limit. */
import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import type { CoreRuntimeHealth } from './Types/core.types.ts'

const coreRuntimeHealthSchema = z
    .object({
        status: z.literal('running'),
        version: z.string().min(1).max(128),
        pid: z.number().int().positive(),
        uptimeSeconds: z.number().finite().nonnegative(),
    })
    .strict() satisfies z.ZodType<CoreRuntimeHealth>

export function getCoreRuntimeOriginService() {
    const url = new URL(process.env.CORE_ORIGIN?.trim() || CORE_RUNTIME.origin)
    if (
        url.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
    ) {
        throw new Error(
            'CORE_ORIGIN muss eine lokale HTTP-Origin ohne Pfad oder Zugangsdaten sein.',
        )
    }
    return url.origin
}

export async function getCoreRuntimeHealthService(): Promise<CoreRuntimeHealth> {
    const response = await fetch(
        new URL(CORE_RUNTIME.healthPath, getCoreRuntimeOriginService()),
        {
            signal: AbortSignal.timeout(CORE_RUNTIME.healthTimeoutMs),
            cache: 'no-store',
            redirect: 'error',
        },
    )
    if (!response.ok) throw new Error('Rust core health unavailable.')
    const declaredBytes = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredBytes) && declaredBytes > 4096)
        throw new Error('Rust core health response is too large.')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Rust core health response is missing.')
    const chunks: Uint8Array[] = []
    let observedBytes = 0
    try {
        while (true) {
            const result = await reader.read()
            if (result.done) break
            observedBytes += result.value.byteLength
            if (observedBytes > 4096)
                throw new Error('Rust core health response is too large.')
            chunks.push(result.value)
        }
    } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
    return coreRuntimeHealthSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
    )
}
