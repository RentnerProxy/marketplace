import { definePlugin } from 'nitro'
import { closeCoreWorkerPoolsService } from '@/server/Core/worker-pool.service.ts'
import { closePrivateStorageWritesService } from '@/server/Storage/private-write-queue.service.ts'
import { closeAppConnectionsService } from './app-connections.service.ts'

export default definePlugin(function coreWorkerLifecycleService(nitroApp) {
    // Nitro closes its HTTP listener before awaiting this shutdown hook.
    nitroApp.hooks.hook('close', async function () {
        try {
            try {
                await closePrivateStorageWritesService()
            } finally {
                await closeCoreWorkerPoolsService()
            }
        } finally {
            // Redis sockets and producer reconnect timers otherwise keep Bun alive after close.
            await closeAppConnectionsService()
        }
    })
})
