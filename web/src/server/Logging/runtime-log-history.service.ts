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
import { defineValkeyScript } from '@/server/Valkey/valkey-script.ts'
import { getOwnLogValue, getSafeErrorDetailsService } from './error-details.ts'
import { sanitizeLogContextService } from './log-context.ts'
import type { LogContext, LogLevel } from './Types/logging.types.ts'
import {
    runtimeLogEntrySchema,
    runtimeLogLinesSchema,
} from './runtime-log.validation.ts'

const errorContextSchema = z.object({
    errorName: z.enum(SAFE_ERROR_NAMES).optional(),
    errorCode: z.enum(SAFE_ERROR_CODES).optional(),
    errorId: z.uuid().optional(),
})
const logLineEntrySchema = runtimeLogEntrySchema.extend({
    event: runtimeLogEntrySchema.shape.event.catch('logging.invalid_event'),
})
const history = new Map<RuntimeLogServiceId, Array<RuntimeLogEntry>>()
const pending = new Map<RuntimeLogServiceId, Array<RuntimeLogEntry>>()
let processService: 'webserver' | 'worker' = 'webserver'
let connection: AppValkeyClient | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | undefined

const appendLogs = defineValkeyScript(
    'tdAppendRuntimeLogs',
    1,
    `
for index = 3, #ARGV do
    server.call('LPUSH', KEYS[1], ARGV[index])
end
server.call('LTRIM', KEYS[1], 0, tonumber(ARGV[1]) - 1)
server.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`,
)
const readLogs = defineValkeyScript(
    'tdReadRuntimeLogs',
    1,
    `
return server.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
`,
)

function sanitizeRuntimeLogContext(context: unknown) {
    const result = sanitizeLogContextService(context)
    const details = errorContextSchema.safeParse({
        errorName: getOwnLogValue(context, 'errorName'),
        errorCode: getOwnLogValue(context, 'errorCode'),
        errorId: getOwnLogValue(context, 'errorId'),
    })
    if (details.success) copyErrorDetails(result, details.data)
    return result
}

function copyErrorDetails(
    context: LogContext,
    details: { errorName?: string; errorCode?: string; errorId?: string },
) {
    if (details.errorName !== undefined) context.errorName = details.errorName
    if (details.errorCode !== undefined) context.errorCode = details.errorCode
    if (details.errorId !== undefined) context.errorId = details.errorId
}

function appendBounded(
    buffers: Map<RuntimeLogServiceId, Array<RuntimeLogEntry>>,
    service: RuntimeLogServiceId,
    entry: RuntimeLogEntry,
) {
    const buffer = buffers.get(service)
    if (buffer) {
        if (buffer.length === RUNTIME_LOGS.maxEntries) buffer.shift()
        buffer.push(entry)
    } else {
        buffers.set(service, [entry])
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
                await appendLogs(
                    client,
                    RUNTIME_LOGS.keyPrefix + service,
                    RUNTIME_LOGS.maxEntries,
                    RUNTIME_LOGS.retentionMs,
                    ...entries.map((entry) => JSON.stringify(entry)),
                )
            } catch {
                hasFailure = true
                // The transport must never block requests or log its own failure.
                const newerEntries = pending.get(service)
                if (newerEntries) entries.push(...newerEntries)
                const excess = entries.length - RUNTIME_LOGS.maxEntries
                if (excess > 0) entries.splice(0, excess)
                pending.set(service, entries)
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
    recordEntry(parsed.data, service)
}

export function recordRuntimeLogLineService(
    level: LogLevel,
    event: string,
    context: LogContext,
    cause?: { error: unknown },
) {
    const parsed = logLineEntrySchema.safeParse({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        event,
        context: sanitizeLogContextService(context),
    })
    if (!parsed.success) return undefined
    const entry = parsed.data
    if (/^(?:realtime|websocket)\./.test(entry.event)) {
        entry.context.service = 'websocket'
    }
    const details = cause ? getSafeErrorDetailsService(cause.error) : undefined
    if (details) copyErrorDetails(entry.context, details)
    recordEntry(entry)
    return (
        JSON.stringify({
            ...entry.context,
            ...details,
            timestamp: entry.timestamp,
            level: entry.level,
            event: entry.event,
        }) + '\n'
    )
}

function recordEntry(entry: RuntimeLogEntry, service?: RuntimeLogServiceId) {
    const owner = service ?? resolveRuntimeLogService(entry)
    appendBounded(history, owner, entry)
    appendBounded(pending, owner, entry)
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
            await readLogs(
                client,
                RUNTIME_LOGS.keyPrefix + service,
                RUNTIME_LOGS.maxEntries,
            ),
        )
        for (let index = result.length - 1; index >= 0; index--) {
            try {
                const line = result[index]
                if (line === undefined) continue
                const entry = runtimeLogEntrySchema.parse(JSON.parse(line))
                entry.context = sanitizeRuntimeLogContext(entry.context)
                entries.set(entry.id, entry)
            } catch {
                // Ungültige Einträge nicht an die Oberfläche weitergeben.
            }
        }
        sharedHistoryAvailable = true
    } catch {
        // Lokale Ereignisse bleiben auch bei einem unterbrochenen Verlauf lesbar.
    }
    for (const entry of history.get(service) ?? []) {
        entries.set(entry.id, { ...entry, context: { ...entry.context } })
    }
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
