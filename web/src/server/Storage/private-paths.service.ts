import { runCoreCommandService } from '@/server/Core/command.service.ts'
import path from 'node:path'
import { z } from 'zod'
import type {
    PrivateStorageDirectorySnapshot,
    NativeDirectorySnapshot,
} from './Types/private-files.types.ts'

const PRIVATE_STORAGE_ERROR = 'Private storage operation failed.'

const nativeUnsignedIdentitySchema = z
    .string()
    .min(1)
    .max(20)
    .refine(function (value) {
        return (
            /^(?:0|[1-9]\d{0,19})$/.test(value) &&
            BigInt(value) <= 18446744073709551615n
        )
    })
export const nativeStorageIdentitySchema = z
    .object({
        dev: nativeUnsignedIdentitySchema,
        ino: nativeUnsignedIdentitySchema.refine((value) => value !== '0'),
    })
    .strict()
export const nativeStorageAbsolutePathSchema = z
    .string()
    .min(1)
    .max(65536)
    .refine(function (value) {
        return (
            !value.includes('\0') &&
            path.isAbsolute(value) &&
            path.resolve(value) === value
        )
    })
const nativeDirectorySnapshotsSchema = z
    .array(
        z
            .object({
                path: nativeStorageAbsolutePathSchema,
                identity: nativeStorageIdentitySchema,
            })
            .strict(),
    )
    .min(1)
    .max(16384)

export async function preparePrivateStorageDirectoriesService(
    rootDirectory: string,
    directoryPath: string,
): Promise<PrivateStorageDirectorySnapshot[]> {
    const directories = await runCoreCommandService<NativeDirectorySnapshot[]>(
        'storage',
        { operation: 'prepareDirectories', rootDirectory, directoryPath },
        {
            validateResult(result) {
                const parsedDirectories =
                    nativeDirectorySnapshotsSchema.parse(result)
                if (
                    parsedDirectories[0]?.path !==
                        path.resolve(rootDirectory) ||
                    parsedDirectories.at(-1)?.path !==
                        path.resolve(directoryPath) ||
                    parsedDirectories.some(function (directory, index) {
                        return (
                            index > 0 &&
                            path.dirname(directory.path) !==
                                parsedDirectories[index - 1]?.path
                        )
                    })
                )
                    throw new Error(PRIVATE_STORAGE_ERROR)
                return parsedDirectories
            },
        },
    )
    return directories.map(function (directory) {
        return {
            path: directory.path,
            identity: {
                dev: BigInt(directory.identity.dev),
                ino: BigInt(directory.identity.ino),
            },
        }
    })
}

export async function assertPrivateStorageDirectoriesUnchangedService(
    directories: ReadonlyArray<PrivateStorageDirectorySnapshot>,
): Promise<void> {
    await runCoreCommandService('storage', {
        operation: 'assertDirectories',
        directories: directories.map(function (directory) {
            return {
                path: directory.path,
                identity: {
                    dev: String(directory.identity.dev),
                    ino: String(directory.identity.ino),
                },
            }
        }),
    })
}
