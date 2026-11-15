import { WORKER_SHUTDOWN } from '@/config/health.config.ts'

export async function waitForWorkerCleanupService(operation: Promise<void>) {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
        return await Promise.race([
            operation.then(() => true),
            new Promise<boolean>(function (resolve) {
                timer = setTimeout(
                    () => resolve(false),
                    WORKER_SHUTDOWN.cleanupTimeoutMs,
                )
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}
