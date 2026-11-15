import path from 'node:path'
import {
    getPrivateStorageRoot,
    getPublicStorageRoot,
    getUserPublicImagePaths,
} from '@/lib/Images/publicImagePaths.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { parseArchiveCoreResultService } from './archive-core.schema.ts'
import type {
    BackgroundStorageEntry,
    BackgroundStorageLayout,
    BackgroundStoragePathsInput,
    CollectBackgroundFilesInput,
    PreparedBackgroundStorage,
} from './Types/archive-background-storage.types.ts'
export function getBackgroundStorageLayoutService(): BackgroundStorageLayout {
    const paths = getUserPublicImagePaths('')
    const layout = {
        publicRelativeDirectory: path.relative(
            getPublicStorageRoot(),
            paths.absoluteDir,
        ),
        privateRelativeDirectory: path.relative(
            getPrivateStorageRoot(),
            paths.absoluteBackgroundDir,
        ),
        fileName: path.basename(paths.absoluteBackground),
    }
    for (const relativeDirectory of [
        layout.publicRelativeDirectory,
        layout.privateRelativeDirectory,
    ]) {
        if (
            !relativeDirectory ||
            path.isAbsolute(relativeDirectory) ||
            relativeDirectory.split(path.sep).includes('..')
        ) {
            throw new Error('Invalid background storage layout')
        }
    }
    return layout
}

export async function assertBackgroundStoragePathsService(
    input: BackgroundStoragePathsInput,
) {
    await runCoreCommandService(
        'archive',
        {
            operation: 'backgroundAssertRoots',
            ...input,
        },
        {
            validateResult: (result) =>
                parseArchiveCoreResultService<null>(
                    'backgroundAssertRoots',
                    result,
                ),
        },
    )
}

export async function collectBackgroundStorageFilesService(
    input: CollectBackgroundFilesInput,
): Promise<BackgroundStorageEntry[]> {
    return runCoreCommandService(
        'archive',
        {
            operation: 'backgroundCollect',
            ...input,
            layout: getBackgroundStorageLayoutService(),
        },
        {
            validateResult: (result) =>
                parseArchiveCoreResultService<BackgroundStorageEntry[]>(
                    'backgroundCollect',
                    result,
                ),
        },
    )
}

export async function partitionRestoredBackgroundStorageService(
    restoreDirectory: string,
): Promise<PreparedBackgroundStorage> {
    return runCoreCommandService(
        'archive',
        {
            operation: 'backgroundPartition',
            restoreDirectory,
            layout: getBackgroundStorageLayoutService(),
        },
        {
            validateResult: (result) =>
                parseArchiveCoreResultService<PreparedBackgroundStorage>(
                    'backgroundPartition',
                    result,
                ),
        },
    )
}
