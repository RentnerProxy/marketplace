import { writeLogLineService } from './log-transport.ts'
import { recordRuntimeLogLineService } from './runtime-log-history.service.ts'
import type { LogContext, LogLevel } from './Types/logging.types.ts'

function writeLog(
    level: LogLevel,
    event: string,
    context: LogContext,
    cause?: { error: unknown },
) {
    const line = recordRuntimeLogLineService(level, event, context, cause)
    if (line)
        writeLogLineService(
            level === 'error' ? process.stderr : process.stdout,
            line,
        )
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
    writeLog('warn', event, context, { error })
}

export function logError(
    event: string,
    error: unknown,
    context: LogContext = {},
) {
    writeLog('error', event, context, { error })
}
