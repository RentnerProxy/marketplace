import { logError } from './logger.ts'
import type { LogContext } from './Types/logging.types.ts'

export async function runBestEffortSideEffectService(
    event: string,
    operation: () => Promise<unknown>,
    metadata?: LogContext,
) {
    try {
        await operation()
    } catch (error) {
        logError(event, error, metadata)
    }
}
