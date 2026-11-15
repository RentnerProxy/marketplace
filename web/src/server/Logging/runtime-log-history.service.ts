import { z } from 'zod'
import {
    RUNTIME_LOGS,
    SAFE_ERROR_CODES,
    SAFE_ERROR_NAMES,
} from '@/config/logging.config.ts'
import type {
    RuntimeLogEntry,
    RuntimeLogInput,
    RuntimeLogServiceId,
    RuntimeLogSnapshot,
} from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import type { AppValkeyClient } from '@/server/Valkey/Types/valkey-client.types.ts'
import { sanitizeLogContextService } from './log-context.ts'
import {
    runtimeLogEntrySchema,
    runtimeLogLinesSchema,
} from './runtime-log.validation.ts'

const errorContextSchema = z.object({
    errorName: z.enum(SAFE_ERROR_NAMES).optional(),
    errorCode: z.enum(SAFE_ERROR_CODES).optional(),
    errorId: z.uuid().optional(),
})
const history = new Map<RuntimeLogServiceId, Array<RuntimeLogEntry>>()
const pending = new Map<RuntimeLogServiceId, Array<RuntimeLogEntry>>()
let processService: 'webserver' | 'worker' = 'webserver'
let connection: AppValkeyClient | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | undefined

const appendLogScript = `
for index = 3, #ARGV do
    server.call('LPUSH', KEYS[1], ARGV[index])
end
server.call('LTRIM', KEYS[1], 0, tonumber(ARGV[1]) - 1)
server.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`
const readLogScript = `
return server.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
`

function sanitizeRuntimeLogContext(context: unknown) {
    const details = errorContextSchema.safeParse(context)
    return {
        ...sanitizeLogContextService(context),
        ...(details.success ? details.data : {}),
    }
}

function scheduleFlush() {
    if (flushTimer || flushing || connection?.status !== 'ready') return
    flushTimer = setTimeout(function () {
        flushTimer = undefined
        void flushHistory()
    }, RUNTIME_LOGS.flushIntervalMs)
    flushTimer.unref()
}

function flushHistory(): Promise<void> {
    if (flushing) return flushing
    const client = connection
    if (!client || client.status !== 'ready') return Promise.resolve()
    const batches = [...pending.entries()]
    pending.clear()
    let hasFailure = false
    flushing = Promise.all(
        batches.map(async function ([service, entries]) {
            try {
                await client.eval(
                    appendLogScript,
                    1,
                    RUNTIME_LOGS.keyPrefix + service,
                    RUNTIME_LOGS.maxEntries,
                    RUNTIME_LOGS.retentionMs,
                    ...entries.map((entry) => JSON.stringify(entry)),
                )
            } catch {
                hasFailure = true
                // Der Logtransport darf weder Anfragen blockieren noch sich selbst loggen.
                pending.set(
                    service,
                    [...entries, ...(pending.get(service) ?? [])].slice(
                        -RUNTIME_LOGS.maxEntries,
                    ),
                )
            }
        }),
    ).then(function () {
        flushing = undefined
        if (!hasFailure && pending.size) scheduleFlush()
        return undefined
    })
    return flushing
}

export function attachRuntimeLogConnectionService(client: AppValkeyClient) {
    if (connection === client) return
    connection?.off('ready', scheduleFlush)
    connection = client
    connection.on('ready', scheduleFlush)
    scheduleFlush()
}

export function setRuntimeLogProcessService(service: 'webserver' | 'worker') {
    processService = service
}

function resolveRuntimeLogService(entry: RuntimeLogEntry): RuntimeLogServiceId {
    const service = entry.context.service
    if (
        service === 'core' ||
        service === 'websocket' ||
        service === 'webserver' ||
        service === 'worker' ||
        service === 'postgresql' ||
        service === 'valkey'
    ) {
        return service
    }
    if (/^(?:realtime|websocket)\./.test(entry.event)) return 'websocket'
    if (entry.event.startsWith('valkey.')) return 'valkey'
    if (/^(?:database|db|postgresql)\./.test(entry.event)) return 'postgresql'
    return processService
}

export function recordRuntimeLogService(
    input: RuntimeLogInput,
    service?: RuntimeLogServiceId,
): void {
    const parsed = runtimeLogEntrySchema.safeParse({
        ...input,
        id: crypto.randomUUID(),
        timestamp: input.timestamp ?? new Date().toISOString(),
        context: sanitizeRuntimeLogContext(input.context),
    })
    if (!parsed.success) return
    const entry = parsed.data
    const owner = service ?? resolveRuntimeLogService(entry)
    history.set(
        owner,
        [...(history.get(owner) ?? []), entry].slice(-RUNTIME_LOGS.maxEntries),
    )
    pending.set(
        owner,
        [...(pending.get(owner) ?? []), entry].slice(-RUNTIME_LOGS.maxEntries),
    )
    scheduleFlush()
}

export async function getRuntimeLogSnapshotService(
    service: RuntimeLogServiceId,
    client: AppValkeyClient,
): Promise<RuntimeLogSnapshot> {
    let sharedHistoryAvailable = false
    const entries = new Map<string, RuntimeLogEntry>()
    try {
        const result = runtimeLogLinesSchema.parse(
            await client.eval(
                readLogScript,
                1,
                RUNTIME_LOGS.keyPrefix + service,
                RUNTIME_LOGS.maxEntries,
            ),
        )
        for (const line of result.toReversed()) {
            try {
                const entry = runtimeLogEntrySchema.parse(JSON.parse(line))
                entries.set(entry.id, {
                    ...entry,
                    context: sanitizeRuntimeLogContext(entry.context),
                })
            } catch {
                // Ungültige Einträge nicht an die Oberfläche weitergeben.
            }
        }
        sharedHistoryAvailable = true
    } catch {
        // Lokale Ereignisse bleiben auch bei einem unterbrochenen Verlauf lesbar.
    }
    for (const entry of history.get(service) ?? []) entries.set(entry.id, entry)
    const cutoff = Date.now() - RUNTIME_LOGS.retentionMs
    return {
        source: 'application',
        entries: [...entries.values()]
            .filter((entry) => Date.parse(entry.timestamp) >= cutoff)
            .toSorted((left, right) =>
                left.timestamp.localeCompare(right.timestamp),
            )
            .slice(-RUNTIME_LOGS.maxEntries),
        sharedHistoryAvailable,
    }
}
