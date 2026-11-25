import { CORE_RUNTIME } from '@/config/core.config.ts'
import { CoreCommandError } from './error.ts'
import { tryRunNativeStorageCommandService } from './native-storage.service.ts'
import { runOneShotCoreCommandService } from './one-shot.service.ts'
import { runPooledCoreCommandService } from './worker-pool.service.ts'
import type { CoreBinary, CoreCommandOptions } from './Types/core.types.ts'

export function runCoreCommandService<TResult>(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options: CoreCommandOptions<TResult> & {
        validateResult: (value: unknown) => TResult
    },
): Promise<TResult>
export function runCoreCommandService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options?: CoreCommandOptions,
): Promise<unknown>
export function runCoreCommandService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    options: CoreCommandOptions = {},
): Promise<unknown> {
    const operations: readonly string[] = CORE_RUNTIME.workerOperations[binary]
    if (
        !options.environment &&
        !options.onProgress &&
        typeof request.operation === 'string' &&
        operations.includes(request.operation)
    ) {
        if (binary === 'storage') {
            const native = tryRunNativeStorageCommandService(request, options)
            if (native) return native
        }
        return runPooledCoreCommandService(binary, request, options)
    }
    // The isolated process only accepts and returns JSON.
    if (
        options.binaryInput !== undefined ||
        'binaryLengths' in request ||
        request.operation === 'writeFile' ||
        request.operation === 'brandingPublish' ||
        request.operation === 'readBackgroundRepresentation'
    )
        return Promise.reject(
            new CoreCommandError(
                'CORE_INVALID_REQUEST',
                'Binäre Core-Aufträge benötigen den privaten Worker-Kanal.',
            ),
        )
    return runOneShotCoreCommandService(binary, request, options)
}
