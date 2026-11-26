import { definePlugin } from 'nitro'
import { closeCoreWorkerPoolsService } from '@/server/Core/worker-pool.service.ts'
import { drainSharedStorageMutationBarrierService } from '@/server/Storage/storage-mutation-barrier.service.ts'
import { closeAppConnectionsService } from './app-connections.service.ts'

export default definePlugin(function coreWorkerLifecycleService(nitroApp) {
    // Nitro closes its HTTP listener before awaiting this shutdown hook.
    nitroApp.hooks.hook('close', async function () {
        try {
            await drainSharedStorageMutationBarrierService()
        } finally {
            try {
                await closeCoreWorkerPoolsService()
            } finally {
                // Redis sockets and producer reconnect timers keep Bun alive after close.
                await closeAppConnectionsService()
            }
        }
    })
})
