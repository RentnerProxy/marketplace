import { LOG_LIMITS } from '@/config/logging.config.ts'
import { getSafeErrorDetailsService } from './error-details.ts'
import { sanitizeLogContextService } from './log-context.ts'
import { writeLogLineService } from './log-transport.ts'
import { recordRuntimeLogService } from './runtime-log-history.service.ts'
import type {
    LogContext,
    LogLevel,
    SafeErrorDetails,
} from './Types/logging.types.ts'

function writeLog(
    level: LogLevel,
    event: string,
    context: LogContext,
    details?: SafeErrorDetails,
) {
    const safeEvent =
        typeof event === 'string' &&
        event.length <= LOG_LIMITS.eventLength &&
        /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+){1,8}$/.test(event)
            ? event
            : 'logging.invalid_event'
    const safeContext = sanitizeLogContextService({
        ...context,
        ...(/^(?:realtime|websocket)\./.test(safeEvent)
            ? { service: 'websocket' }
            : {}),
    })
    const timestamp = new Date().toISOString()
    const entry = JSON.stringify({
        ...safeContext,
        ...details,
        timestamp,
        level,
        event: safeEvent,
    })
    writeLogLineService(
        level === 'error' ? process.stderr : process.stdout,
        entry + '\n',
    )
    recordRuntimeLogService({
        timestamp,
        level,
        event: safeEvent,
        context: {
            ...safeContext,
            errorName: details?.errorName,
            errorCode: details?.errorCode,
            errorId: details?.errorId,
        },
    })
}

export function logInfo(event: string, context: LogContext = {}) {
    writeLog('info', event, context)
}

export function logWarn(event: string, context: LogContext = {}) {
    writeLog('warn', event, context)
}

export function logWarnError(
    event: string,
    error: unknown,
    context: LogContext = {},
) {
    writeLog('warn', event, context, getSafeErrorDetailsService(error))
}

export function logError(
    event: string,
    error: unknown,
    context: LogContext = {},
) {
    writeLog('error', event, context, getSafeErrorDetailsService(error))
}
