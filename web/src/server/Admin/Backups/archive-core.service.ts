import type { FileHandle } from 'node:fs/promises'
import type { BackupImportContext } from './import.types.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { parseArchiveCoreResultService } from './archive-core.schema.ts'

export async function getArchiveSourceIdentityService(source: FileHandle) {
    const stats = await source.stat({ bigint: true })
    return {
        dev: String(stats.dev),
        ino: String(stats.ino),
        size: String(stats.size),
        mtimeNs: String(stats.mtimeNs),
        ctimeNs: String(stats.ctimeNs),
    }
}

export async function runArchiveCoreService<T>(
    request: Record<string, unknown>,
    context?: BackupImportContext,
    onProgress?: (progress: unknown) => void | Promise<void>,
): Promise<T> {
    context?.assertActive()
    try {
        const result = await runCoreCommandService<T>(
            'archive',
            {
                ...request,
                key: getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
                ...(context
                    ? { capacityDirectory: context.temporaryDirectory }
                    : {}),
            },
            {
                signal: context?.signal,
                onProgress,
                validateResult: (reply) =>
                    parseArchiveCoreResultService<T>(request.operation, reply),
            },
        )
        context?.assertActive()
        return result
    } catch (error) {
        if (
            error instanceof Error &&
            (('isUncertain' in error && error.isUncertain === true) ||
                ('code' in error &&
                    (error.code === 'CORE_OPERATION_UNCERTAIN' ||
                        error.code === 'ARCHIVE_CLEANUP_INCOMPLETE')))
        ) {
            context?.markCleanupIncomplete()
        }
        throw error
    }
}

export function readArchiveProgressService(progress: unknown) {
    if (
        typeof progress !== 'object' ||
        progress === null ||
        !('processedBytes' in progress) ||
        !('totalBytes' in progress) ||
        typeof progress.processedBytes !== 'number' ||
        typeof progress.totalBytes !== 'number' ||
        !Number.isSafeInteger(progress.processedBytes) ||
        !Number.isSafeInteger(progress.totalBytes) ||
        progress.processedBytes < 0 ||
        progress.totalBytes < progress.processedBytes
    ) {
        throw new Error('Der Core-Fortschritt ist ungültig.')
    }
    return {
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
    }
}
