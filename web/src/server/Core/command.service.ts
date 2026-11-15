import { CORE_RUNTIME } from '@/config/core.config.ts'
import { CoreCommandError } from './error.ts'
import {
    encodeIsolatedBinaryRequestService,
    validateCoreBinaryInputService,
} from './binary-payload.service.ts'
import { runOneShotCoreCommandService } from './one-shot.service.ts'
import { runPooledCoreCommandService } from './worker-pool.service.ts'
import type {
    CoreBinary,
    CoreBrandingBinaryLengths,
    CoreCommandOptions,
} from './Types/core.types.ts'

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
        return runPooledCoreCommandService(binary, request, options)
    }
    // Explicit environments and long/progress-producing operations retain their
    // isolated process and its existing cancellation and completion guarantees.
    if (request.operation === 'readBackgroundBytes')
        return Promise.reject(
            new CoreCommandError(
                'CORE_INVALID_REQUEST',
                'Binäre Core-Antworten benötigen den privaten Worker-Kanal.',
            ),
        )
    let lengths: CoreBrandingBinaryLengths | undefined
    try {
        lengths = validateCoreBinaryInputService(
            binary,
            request,
            options.binaryInput,
        )
    } catch (error) {
        return Promise.reject(error)
    }
    if (options.binaryInput !== undefined) {
        return runOneShotCoreCommandService(
            binary,
            encodeIsolatedBinaryRequestService(
                request,
                options.binaryInput,
                lengths,
            ),
            options,
        )
    }
    return runOneShotCoreCommandService(binary, request, options)
}
