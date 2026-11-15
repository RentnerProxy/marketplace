import { logError, logWarn } from '@/server/Logging/logger.ts'
import { closeAppConnectionsService } from '@/server/Runtime/app-connections.service.ts'
import { waitForWorkerCleanupService } from '@/server/Runtime/worker-cleanup.service.ts'
import type {
    ProductionShutdownOptions,
    ProductionShutdownSignal,
} from './production.types.ts'

export async function shutdownProductionServerService(
    options: ProductionShutdownOptions,
    signal: ProductionShutdownSignal,
) {
    let failures = 0

    async function cleanup(name: string, operation: () => Promise<unknown>) {
        try {
            if (
                await waitForWorkerCleanupService(
                    Promise.resolve()
                        .then(operation)
                        .then(() => undefined),
                )
            ) {
                return true
            }
            logWarn(`production.shutdown_${name}_timeout`)
        } catch (error) {
            logError(`production.shutdown_${name}_failed`, error)
        }
        failures += 1
        return false
    }

    try {
        options.stopSetupLog()
    } catch (error) {
        failures += 1
        logError('production.shutdown_setup_log_failed', error)
    }

    const serverClosed = cleanup('server', () => options.server.stop(true))
    // Forward immediately: stalled proxy/WebSocket cleanup must not prevent the app drain.
    try {
        options.appProcess.kill(signal)
    } catch (error) {
        failures += 1
        logError('production.shutdown_signal_failed', error)
    }

    // Never apply a technical connection timeout to the app's owned work.
    const exitCode = await options.appProcess.exited
    await serverClosed
    if (exitCode !== 0) {
        failures += 1
        logWarn('production.shutdown_app_failed')
    }

    const subscriber = options.subscriber
    if (subscriber) {
        const closed =
            subscriber.status === 'ready' &&
            (await cleanup('subscriber', () => subscriber.quit()))
        if (!closed) {
            try {
                subscriber.disconnect()
            } catch (error) {
                failures += 1
                logError(
                    'production.shutdown_subscriber_disconnect_failed',
                    error,
                )
            }
        }
    }
    try {
        await closeAppConnectionsService()
    } catch (error) {
        failures += 1
        logError('production.shutdown_connections_failed', error)
    }
    return failures === 0 ? 0 : 1
}
