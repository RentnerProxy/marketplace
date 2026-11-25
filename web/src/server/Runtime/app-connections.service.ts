import { logWarn } from '@/server/Logging/logger.ts'
import { waitForWorkerCleanupService } from './worker-cleanup.service.ts'

const closingResources = new WeakMap<object, Promise<void>>()

function closeOnce(resource: object, operation: () => Promise<void>) {
    let closing = closingResources.get(resource)
    if (!closing) {
        closing = Promise.resolve().then(operation)
        closingResources.set(resource, closing)
    }
    return closing
}

async function attempt(name: string, operation: () => Promise<unknown>) {
    try {
        if (
            await waitForWorkerCleanupService(operation().then(() => undefined))
        ) {
            return true
        }
        logWarn(`runtime.connections.${name}_timeout`)
    } catch {
        logWarn(`runtime.connections.${name}_failed`)
    }
    return false
}

async function closeValkey() {
    const client = globalThis.appValkeyConnection
    if (!client) return
    await closeOnce(client, async function () {
        if (
            client.status === 'ready' &&
            (await attempt('valkey_connection_quit', () => client.quit()))
        ) {
            return
        }
        try {
            client.disconnect()
        } catch {
            logWarn('runtime.connections.valkey_connection_disconnect_failed')
            throw new Error('Failed to disconnect Valkey.')
        }
    })
}

async function closeDatabase() {
    const client = globalThis.appDatabaseConnection
    if (!client) return
    await closeOnce(client, async function () {
        if (await attempt('database_close', () => client.close())) return
        throw new Error('Failed to close the database connection.')
    })
}

/** Call only after HTTP requests, queue processors and Core writes have drained. */
export async function closeAppConnectionsService(): Promise<void> {
    const failures: unknown[] = []
    const queues = [
        ['mail_queue', globalThis.appMailQueueV2],
        ['backup_queue', globalThis.appBackupQueue],
    ] as const
    const queueResults = await Promise.allSettled(
        queues.map(async function ([name, queue]) {
            if (!queue) return
            await closeOnce(queue, async function () {
                if (await attempt(`${name}_close`, () => queue.close())) return
                if (
                    await attempt(`${name}_disconnect`, () =>
                        queue.disconnect(),
                    )
                )
                    return
                throw new Error(
                    `Verbindung konnte nicht beendet werden: ${name}`,
                )
            })
        }),
    )
    for (const result of queueResults) {
        if (result.status === 'rejected') failures.push(result.reason)
    }

    const clientResults = await Promise.allSettled([
        closeValkey(),
        closeDatabase(),
    ])
    for (const result of clientResults) {
        if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length) {
        throw new AggregateError(
            failures,
            'Anwendungsverbindungen konnten nicht vollständig beendet werden.',
        )
    }
}
