import { lstat, rm } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { user_settings } from '@/db/schema.ts'
import { DEFAULT_BACKGROUND_DARKNESS } from '@/config/user-theme-colors.config.ts'
import {
    prepareAuditContextService,
    writeStandaloneAuditLogService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { runAuditedUserSettingsMutationService } from './settings-mutation.service.ts'
import {
    getImageBufferFromDataUrl,
    getSafeImageCrop,
} from '@/lib/Images/imageDataUrl.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { getUserPublicImagePaths } from '@/lib/Images/publicImagePaths.ts'
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import { writePrivateStorageFileService } from '@/server/Storage/private-files.service.ts'
import sharp from 'sharp'
import type {
    UpdateCurrentUserBackgroundAppearanceInput,
    UpdateCurrentUserBackgroundInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'

export async function updateCurrentUserBackgroundAppearanceService(
    data: UpdateCurrentUserBackgroundAppearanceInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser)
        return { success: false as const, error: 'Du bist nicht angemeldet.' }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.background_appearance_updated',
            message: 'Hintergrund-Darstellung wurde aktualisiert.',
        },
        async function (transaction) {
            const previous = (
                await transaction
                    .select({
                        customBackgroundDarkness:
                            user_settings.customBackgroundDarkness,
                    })
                    .from(user_settings)
                    .where(eq(user_settings.userId, currentUser.id))
                    .limit(1)
            ).at(0)
            if (
                previous?.customBackgroundDarkness ===
                data.customBackgroundDarkness
            ) {
                return {
                    changed: false,
                    value: {
                        success: true as const,
                        customBackgroundDarkness: data.customBackgroundDarkness,
                    },
                }
            }
            const updated = (
                await transaction
                    .insert(user_settings)
                    .values({
                        userId: currentUser.id,
                        customBackgroundDarkness: data.customBackgroundDarkness,
                    })
                    .onConflictDoUpdate({
                        target: user_settings.userId,
                        set: {
                            customBackgroundDarkness:
                                data.customBackgroundDarkness,
                        },
                    })
                    .returning({
                        customBackgroundDarkness:
                            user_settings.customBackgroundDarkness,
                    })
            ).at(0)
            if (!updated)
                throw new Error(
                    'Background appearance update did not return a row',
                )
            const darkness =
                updated.customBackgroundDarkness ??
                data.customBackgroundDarkness
            return {
                changed: true,
                value: {
                    success: true as const,
                    customBackgroundDarkness: darkness,
                },
                oldValues: {
                    customBackgroundDarkness:
                        previous?.customBackgroundDarkness ?? null,
                },
                newValues: { customBackgroundDarkness: darkness },
            }
        },
    )
}

export async function updateCurrentUserBackgroundService(
    data: UpdateCurrentUserBackgroundInput,
) {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser)
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    const image = await getImageBufferFromDataUrl(data.imageDataUrl)
    const paths = getUserPublicImagePaths(currentUser.id)
    const crop = getSafeImageCrop(data.crop, image)
    const operationId = Bun.randomUUIDv7()
    const context = prepareAuditContextService(currentUser.id)

    return withSharedStorageMutationBarrier(async function () {
        await writeStandaloneAuditLogService({
            ...context,
            action: 'user.background_update_started',
            message: 'Änderung des Hintergrundbilds wurde begonnen.',
            newValues: { operationId },
        })
        const encodedImage = await sharp(image.buffer, {
            limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
        })
            .extract(crop)
            .resize(
                IMAGE_UPLOAD_CONFIG.background.width,
                IMAGE_UPLOAD_CONFIG.background.height,
                { fit: 'inside' },
            )
            .webp({ quality: IMAGE_UPLOAD_CONFIG.background.quality })
            .toBuffer()
        await writePrivateStorageFileService({
            rootDirectory: paths.absolutePrivateStorageRoot,
            filePath: paths.absoluteBackground,
            data: encodedImage,
        })
        await rm(paths.absoluteLegacyBackground, { force: true })
        const updatedAt = new Date()

        return runAuditedUserSettingsMutationService(
            currentUser.id,
            {
                action: 'user.background_updated',
                message: 'Hintergrundbild wurde aktualisiert.',
            },
            async function (transaction) {
                const previous = (
                    await transaction
                        .select({
                            customBackgroundDarkness:
                                user_settings.customBackgroundDarkness,
                        })
                        .from(user_settings)
                        .where(eq(user_settings.userId, currentUser.id))
                        .limit(1)
                ).at(0)
                const darkness =
                    data.customBackgroundDarkness ??
                    previous?.customBackgroundDarkness ??
                    DEFAULT_BACKGROUND_DARKNESS
                const updated = await transaction
                    .insert(user_settings)
                    .values({
                        userId: currentUser.id,
                        customBackgroundDarkness: darkness,
                        customBackgroundUpdatedAt: updatedAt,
                    })
                    .onConflictDoUpdate({
                        target: user_settings.userId,
                        set: {
                            customBackgroundDarkness: darkness,
                            customBackgroundUpdatedAt: updatedAt,
                        },
                    })
                    .returning({ userId: user_settings.userId })
                if (!updated.at(0))
                    throw new Error('Background update did not return a row')
                return {
                    changed: true,
                    value: {
                        success: true as const,
                        customBackgroundDarkness: darkness,
                        customBackgroundUpdatedAt: updatedAt.toISOString(),
                        backgroundSrc: `${paths.relativeBackground}?v=${updatedAt.toISOString()}`,
                    },
                    oldValues: {
                        customBackgroundDarkness:
                            previous?.customBackgroundDarkness ?? null,
                    },
                    newValues: {
                        operationId,
                        customBackgroundDarkness: darkness,
                        customBackgroundUpdatedAt: updatedAt.toISOString(),
                    },
                }
            },
        )
    })
}

async function backgroundPathExists(path: string) {
    try {
        await lstat(path)
        return true
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            return false
        throw error
    }
}

export async function deleteCurrentUserBackgroundService() {
    const currentUser = await getCurrentUserSettingsSession()
    if (!currentUser)
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    const paths = getUserPublicImagePaths(currentUser.id)
    const operationId = Bun.randomUUIDv7()

    return withSharedStorageMutationBarrier(async function () {
        const shouldDelete = await runAuditedUserSettingsMutationService(
            currentUser.id,
            {
                action: 'user.background_delete_started',
                message: 'Löschung des Hintergrundbilds wurde begonnen.',
            },
            async function (transaction) {
                const previous = (
                    await transaction
                        .select({
                            customBackgroundDarkness:
                                user_settings.customBackgroundDarkness,
                            customBackgroundUpdatedAt:
                                user_settings.customBackgroundUpdatedAt,
                        })
                        .from(user_settings)
                        .where(eq(user_settings.userId, currentUser.id))
                        .limit(1)
                ).at(0)
                if (
                    previous?.customBackgroundDarkness === null &&
                    previous.customBackgroundUpdatedAt === null
                ) {
                    const existing = await Promise.all([
                        backgroundPathExists(paths.absoluteBackground),
                        backgroundPathExists(paths.absoluteLegacyBackground),
                    ])
                    if (!existing.some(Boolean))
                        return { changed: false, value: false }
                }
                return {
                    changed: true,
                    value: true,
                    newValues: { operationId },
                }
            },
        )
        if (!shouldDelete) return { success: true as const }

        await rm(paths.absoluteLegacyBackground, { force: true })
        await rm(paths.absoluteBackground, { force: true })
        return runAuditedUserSettingsMutationService(
            currentUser.id,
            {
                action: 'user.background_deleted',
                message: 'Hintergrundbild wurde gelöscht.',
            },
            async function (transaction) {
                const previous = (
                    await transaction
                        .select({
                            customBackgroundDarkness:
                                user_settings.customBackgroundDarkness,
                        })
                        .from(user_settings)
                        .where(eq(user_settings.userId, currentUser.id))
                        .limit(1)
                ).at(0)
                const updated = await transaction
                    .insert(user_settings)
                    .values({
                        userId: currentUser.id,
                        customBackgroundDarkness: null,
                        customBackgroundUpdatedAt: null,
                    })
                    .onConflictDoUpdate({
                        target: user_settings.userId,
                        set: {
                            customBackgroundDarkness: null,
                            customBackgroundUpdatedAt: null,
                        },
                    })
                    .returning({ userId: user_settings.userId })
                if (!updated.at(0))
                    throw new Error('Background deletion did not return a row')
                return {
                    changed: true,
                    value: { success: true as const },
                    oldValues: {
                        customBackgroundDarkness:
                            previous?.customBackgroundDarkness ?? null,
                    },
                    newValues: {
                        operationId,
                        customBackgroundDarkness: null,
                        customBackgroundUpdatedAt: null,
                    },
                }
            },
        )
    })
}
