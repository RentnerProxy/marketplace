import path from 'node:path'
import { z } from 'zod'
import {
    BACKUP_LIMITS,
    BACKUP_LEGACY_MANIFEST_VERSION,
    BACKUP_MANIFEST_VERSION,
    BACKUP_PRIVATE_BACKGROUNDS_VERSION,
} from '@/config/backup.config.ts'

const bytes = z.number().int().nonnegative().max(BACKUP_LIMITS.maxArchiveBytes)
const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const absolutePath = z
    .string()
    .min(1)
    .max(32767)
    .refine((value) => path.isAbsolute(value) && !value.includes('\0'))
const relativePath = z
    .string()
    .min(1)
    .max(BACKUP_LIMITS.maxArchivePathBytes)
    .refine(
        (value) =>
            !path.isAbsolute(value) &&
            !/^[a-z]:/i.test(value) &&
            !value.includes('\0') &&
            value
                .split(/[\\/]/)
                .every(
                    (segment) =>
                        segment.length > 0 &&
                        segment !== '.' &&
                        segment !== '..',
                ),
    )
const identity = z
    .object({
        dev: z.string().regex(/^\d{1,20}$/),
        ino: z.string().regex(/^\d{1,20}$/),
    })
    .strict()
const manifestFields = {
    createdAt: z.iso.datetime(),
    appVersion: z.string().min(1).max(BACKUP_LIMITS.maxManifestBytes),
}
export const archiveManifestSchema = z.union([
    z
        .object({
            ...manifestFields,
            version: z.literal(BACKUP_LEGACY_MANIFEST_VERSION),
            includesStorage: z.boolean(),
        })
        .strict(),
    z
        .object({
            ...manifestFields,
            version: z.literal(BACKUP_MANIFEST_VERSION),
            includesStorage: z.literal(false),
        })
        .strict(),
    z
        .object({
            ...manifestFields,
            version: z.literal(BACKUP_MANIFEST_VERSION),
            includesStorage: z.literal(true),
            privateBackgroundsVersion: z.literal(
                BACKUP_PRIVATE_BACKGROUNDS_VERSION,
            ),
        })
        .strict(),
])
const encryptionMetadata = z
    .object({
        archiveSize: bytes.min(70),
        plaintextSize: z
            .number()
            .int()
            .nonnegative()
            .max(BACKUP_LIMITS.maxPlaintextArchiveBytes),
        checksumSha256: checksum,
    })
    .strict()
    .refine((value) => value.archiveSize === value.plaintextSize + 70)
const validatedArchive = z
    .object({
        archiveSize: bytes.min(70),
        checksumSha256: checksum,
        manifest: archiveManifestSchema,
    })
    .strict()
const entry = z.discriminatedUnion('type', [
    z
        .object({
            path: relativePath,
            size: z
                .number()
                .int()
                .nonnegative()
                .max(BACKUP_LIMITS.maxExtractedBytes),
            type: z.literal('file'),
        })
        .strict(),
    z
        .object({
            path: relativePath,
            size: z.literal(0),
            type: z.literal('directory'),
        })
        .strict(),
])
const collectionEntry = z.discriminatedUnion('type', [
    z
        .object({
            path: relativePath,
            size: z
                .number()
                .int()
                .nonnegative()
                .max(BACKUP_LIMITS.maxExtractedBytes),
            type: z.literal('file'),
            absolutePath,
        })
        .strict(),
    z
        .object({
            path: relativePath,
            size: z.literal(0),
            type: z.literal('directory'),
            absolutePath: z.null(),
        })
        .strict(),
])
export const archiveAdmissionSchema = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
const schemas = {
    validateKey: z.null(),
    encrypt: encryptionMetadata,
    decrypt: encryptionMetadata,
    authenticate: encryptionMetadata,
    create: encryptionMetadata,
    validate: validatedArchive,
    extract: validatedArchive,
    copy: z.object({ archiveSize: bytes, checksumSha256: checksum }).strict(),
    collect: z.array(collectionEntry).max(BACKUP_LIMITS.maxArchiveEntries),
    validateEntry: entry,
    processTar: archiveManifestSchema,
    backgroundAssertRoots: z.null(),
    backgroundCollect: z
        .array(
            z
                .object({
                    absolutePath,
                    publicRelativePath: relativePath,
                    privateRelativePath: relativePath,
                    size: z
                        .number()
                        .int()
                        .nonnegative()
                        .max(BACKUP_LIMITS.maxExtractedBytes),
                    identity,
                })
                .strict(),
        )
        .max(BACKUP_LIMITS.maxArchiveEntries),
    backgroundPartition: z
        .object({
            restoredStoragePath: absolutePath,
            relativeFilePaths: z
                .array(relativePath)
                .max(BACKUP_LIMITS.maxArchiveEntries),
        })
        .strict(),
    admissionAcquire: archiveAdmissionSchema,
    admissionReserve: z.null(),
    admissionRelease: z.null(),
    admissionMarkIncomplete: z.null(),
}

function isArchiveOperation(
    operation: unknown,
): operation is keyof typeof schemas {
    return typeof operation === 'string' && Object.hasOwn(schemas, operation)
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Existing service contracts are preserved at this single schema-validated transport boundary.
export function parseArchiveCoreResultService<T>(
    operation: unknown,
    result: unknown,
): T {
    if (!isArchiveOperation(operation))
        throw new Error('Der Archivvertrag wird nicht unterstützt.')
    const schema = schemas[operation]
    // The single generic transport assertion follows complete operation-specific
    // runtime validation; service callers retain their existing domain contracts.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Every field was validated by the matching operation schema; callers use the corresponding domain contract.
    return schema.parse(result) as T
}
