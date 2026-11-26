import { dlopen, FFIType, toArrayBuffer, type Pointer } from 'bun:ffi'
import { z } from 'zod'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { logError, logInfo, logWarn } from '@/server/Logging/logger.ts'
import { getCoreStorageLibraryPaths } from './binary.service.ts'
import { CoreCommandError, isUncertainCoreErrorCode } from './error.ts'
import { coreErrorFrameSchema, coreResultFrameSchema } from './protocol.ts'
import type { CoreCommandOptions } from './Types/core.types.ts'

const config = CORE_RUNTIME.storageFfi
const operations: readonly string[] = config.operations
const symbols = {
    marketplace_storage_abi_version: { returns: FFIType.u32 },
    marketplace_storage_execute: {
        args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.u8],
        returns: FFIType.ptr,
    },
    marketplace_storage_output_json: {
        args: [FFIType.ptr],
        returns: FFIType.ptr,
    },
    marketplace_storage_output_json_len: {
        args: [FFIType.ptr],
        returns: FFIType.u64,
    },
    marketplace_storage_output_free: {
        args: [FFIType.ptr],
        returns: FFIType.void,
    },
} as const
type StorageLibrary = ReturnType<typeof dlopen<typeof symbols>>
const loadAttempts = new Map<
    string,
    { library: StorageLibrary | undefined; fallbackLogged: boolean }
>()

const decoder = new TextDecoder('utf-8', { fatal: true })
const responseSchema = z.discriminatedUnion('type', [
    coreResultFrameSchema,
    coreErrorFrameSchema,
])

function loadLibrary(paths: string[]): StorageLibrary | undefined {
    if (process.platform !== 'win32' && process.platform !== 'linux')
        return undefined
    for (const filename of paths) {
        let library: StorageLibrary | undefined
        try {
            library = dlopen(filename, symbols)
            if (
                library.symbols.marketplace_storage_abi_version() ===
                config.abiVersion
            )
                return library
        } catch {
            // This path is tried before any storage operation has been submitted.
        }
        library?.close()
    }
    return undefined
}

function getLibrary(required: boolean): StorageLibrary | undefined {
    const paths = getCoreStorageLibraryPaths()
    const key = paths.join('\0')
    let attempt = loadAttempts.get(key)
    if (!attempt) {
        attempt = { library: loadLibrary(paths), fallbackLogged: false }
        loadAttempts.set(key, attempt)
    }
    if (!attempt.library && !required && !attempt.fallbackLogged) {
        attempt.fallbackLogged = true
        logWarn('core.storage_ffi_unavailable_using_worker', {
            service: 'core',
            platform: process.platform,
            abiVersion: config.abiVersion,
        })
    }
    return attempt.library
}

function isShortRequest(
    request: Record<string, unknown>,
    operation: string,
    options: CoreCommandOptions,
) {
    if (
        options.signal ||
        options.timeoutMs !== undefined ||
        options.binaryInput !== undefined ||
        'binaryLengths' in request
    )
        return false
    // Legacy paths allow a stat to publish a migrated file and sync both directories.
    if (operation === 'statBackground')
        return !('legacyRoot' in request || 'legacyPath' in request)
    if (operation === 'capacity') {
        const requests: unknown = request.requests
        return (
            Array.isArray(requests) &&
            requests.length <= config.maxBatchSize &&
            requests.every(
                (entry: unknown) =>
                    typeof entry === 'object' &&
                    entry !== null &&
                    'sourcePaths' in entry &&
                    Array.isArray(entry.sourcePaths) &&
                    entry.sourcePaths.length === 0,
            )
        )
    }
    return true
}

function protocolError() {
    return new CoreCommandError(
        'CORE_PROTOCOL_ERROR',
        'Das Ergebnis des Core-Auftrags konnte nicht bestätigt werden.',
        { uncertain: true },
    )
}

function readResult(
    library: StorageLibrary['symbols'],
    output: Pointer | bigint,
) {
    const json = library.marketplace_storage_output_json(output)
    const jsonBytes = Number(
        library.marketplace_storage_output_json_len(output),
    )
    if (!json || jsonBytes <= 0 || jsonBytes > CORE_RUNTIME.maxRecordBytes)
        throw protocolError()
    const decoded: unknown = JSON.parse(
        decoder.decode(toArrayBuffer(json, 0, jsonBytes)),
    )
    const reply = responseSchema.parse(decoded)
    if (reply.type === 'error')
        throw new CoreCommandError(reply.error.code, reply.error.message, {
            uncertain: isUncertainCoreErrorCode(reply.error.code),
        })
    return reply.result
}

async function runNativeStorageCommand(
    library: StorageLibrary['symbols'],
    operation: string,
    metadata: string,
    options: CoreCommandOptions,
) {
    const startedAt = performance.now()
    const logLifecycle = !CORE_RUNTIME.quietOperations.storage.some(
        (quiet) => quiet === operation,
    )
    try {
        if (logLifecycle) logInfo('core.storage_started', { service: 'core' })
        const json = Buffer.from(metadata, 'utf8')
        let result: unknown
        try {
            const output = library.marketplace_storage_execute(
                json,
                BigInt(json.byteLength),
                null,
                0n,
                0,
            )
            if (!output) throw protocolError()
            try {
                result = readResult(library, output)
            } finally {
                library.marketplace_storage_output_free(output)
            }
        } catch (error) {
            throw error instanceof CoreCommandError ? error : protocolError()
        } finally {
            json.fill(0)
        }
        let validated: unknown
        try {
            validated = options.validateResult
                ? options.validateResult(result)
                : result
        } catch {
            throw protocolError()
        }
        if (logLifecycle)
            logInfo('core.storage_completed', {
                service: 'core',
                durationMs: Math.round(performance.now() - startedAt),
            })
        return validated
    } catch (error) {
        logError('core.storage_failed', error, {
            service: 'core',
            durationMs: Math.round(performance.now() - startedAt),
        })
        throw error
    }
}

export function tryRunNativeStorageCommandService(
    request: Record<string, unknown>,
    options: CoreCommandOptions,
): Promise<unknown> | undefined {
    const mode = process.env.CORE_STORAGE_FFI
    const operation = request.operation
    if (
        mode === 'disabled' ||
        typeof operation !== 'string' ||
        !operations.includes(operation) ||
        !isShortRequest(request, operation, options)
    )
        return undefined

    let metadata: string
    try {
        metadata = JSON.stringify(request)
        if (Buffer.byteLength(metadata) > config.maxMetadataBytes)
            return undefined
    } catch (error) {
        return Promise.reject(error)
    }
    const library = getLibrary(mode === 'required')
    if (!library) {
        if (mode === 'required')
            return Promise.reject(
                new CoreCommandError(
                    'CORE_UNAVAILABLE',
                    'Die native Storage-Bibliothek ist nicht verfügbar oder inkompatibel.',
                ),
            )
        return undefined
    }
    // Once the native call starts, its result or error is final.
    return runNativeStorageCommand(
        library.symbols,
        operation,
        metadata,
        options,
    )
}
