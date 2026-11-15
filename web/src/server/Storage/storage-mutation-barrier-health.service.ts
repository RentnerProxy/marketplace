import { logError } from '@/server/Logging/logger.ts'

let storageMutationBarrierIsHealthy = true
let fatalBarrierFailureHandler: (() => void) | null = null

export function isStorageMutationBarrierHealthyService() {
    return storageMutationBarrierIsHealthy
}

export function setStorageMutationBarrierFatalFailureHandlerService(
    handler: () => void,
) {
    fatalBarrierFailureHandler = handler
}

export function installStorageMutationBarrierFatalExitHandlerService() {
    setStorageMutationBarrierFatalFailureHandlerService(function () {
        const exitTimer = setTimeout(function () {
            process.exit(1)
        }, 0)
        exitTimer.unref()
    })
}

export function markStorageMutationBarrierUnhealthyService(error: unknown) {
    storageMutationBarrierIsHealthy = false

    try {
        fatalBarrierFailureHandler?.()
    } catch (handlerError) {
        logError(
            'storage.mutation_barrier.fatal_failure_handler_failed',
            handlerError,
            { originalError: error instanceof Error ? error.name : 'unknown' },
        )
    }
}
