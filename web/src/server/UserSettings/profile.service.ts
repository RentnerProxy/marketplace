import { mkdir, open, rename, rm } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { user_profiles } from '@/db/schema.ts'
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
import { prepareImageVariantSource } from '@/lib/Images/prepareImageVariantSource.ts'
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import type {
    UpdateCurrentUserBioInput,
    UpdateCurrentUserProfileImageInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'

async function replaceProfileImageFile(
    filePath: string,
    image: Buffer,
    operationId: string,
) {
    const temporaryPath = `${filePath}.${operationId}.tmp`
    const file = await open(temporaryPath, 'wx')
    try {
        try {
            await file.writeFile(image)
        } finally {
            await file.close()
        }
        await rename(temporaryPath, filePath)
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
    }
}

export async function updateCurrentUserProfileImageService(
    data: UpdateCurrentUserProfileImageInput,
) {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const image = await getImageBufferFromDataUrl(data.imageDataUrl)
    const paths = getUserPublicImagePaths(currentUser.id)
    const crop = getSafeImageCrop(data.crop, image)

    const operationId = Bun.randomUUIDv7()
    const auditContext = prepareAuditContextService(currentUser.id)
    return withSharedStorageMutationBarrier(async function () {
        await writeStandaloneAuditLogService({
            ...auditContext,
            action: 'user.profile_image_update_started',
            message: 'Änderung des Profilbilds wurde begonnen.',
            newValues: { operationId },
        })
        const config = IMAGE_UPLOAD_CONFIG.profile
        const createVariant = await prepareImageVariantSource(
            image.buffer,
            crop,
            config.width,
            config.height,
        )
        const [profileImage, thumbnail] = await Promise.all([
            createVariant().webp({ quality: config.quality }).toBuffer(),
            createVariant()
                .resize(config.thumbnailWidth, config.thumbnailHeight)
                .webp({ quality: config.thumbnailQuality })
                .toBuffer(),
        ])
        await mkdir(paths.absoluteDir, { recursive: true })
        await replaceProfileImageFile(
            paths.absoluteProfile,
            profileImage,
            operationId,
        )
        await replaceProfileImageFile(
            paths.absoluteProfileSmall,
            thumbnail,
            operationId,
        )

        const profileImageUpdatedAt = new Date()
        const version = profileImageUpdatedAt.getTime()

        return runAuditedUserSettingsMutationService(
            currentUser.id,
            {
                action: 'user.profile_image_updated',
                message: 'Profilbild wurde aktualisiert.',
            },
            async function (transaction) {
                const updated = await transaction
                    .insert(user_profiles)
                    .values({ userId: currentUser.id, profileImageUpdatedAt })
                    .onConflictDoUpdate({
                        target: user_profiles.userId,
                        set: { profileImageUpdatedAt },
                    })
                    .returning({ userId: user_profiles.userId })
                if (!updated.at(0))
                    throw new Error('Profile image update did not return a row')
                return {
                    changed: true as const,
                    value: {
                        success: true as const,
                        profileImageVersion: version,
                        profileImageSrc: `${paths.relativeProfile}?v=${version}`,
                        profileImageSrc64: `${paths.relativeProfileSmall}?v=${version}`,
                    },
                    newValues: {
                        operationId,
                        profileImageUpdatedAt:
                            profileImageUpdatedAt.toISOString(),
                    },
                }
            },
        )
    })
}

export async function updateCurrentUserBioService(
    data: UpdateCurrentUserBioInput,
) {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const bio = data.bio.trim() || null

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.bio_updated',
            message: 'Profilbeschreibung wurde aktualisiert.',
        },
        async function (transaction) {
            const previous = (
                await transaction
                    .select({ bio: user_profiles.bio })
                    .from(user_profiles)
                    .where(eq(user_profiles.userId, currentUser.id))
                    .limit(1)
            ).at(0)
            if (previous && previous.bio === bio) {
                return {
                    changed: false as const,
                    value: { success: true as const, bio },
                }
            }
            const updated = (
                await transaction
                    .insert(user_profiles)
                    .values({ userId: currentUser.id, bio })
                    .onConflictDoUpdate({
                        target: user_profiles.userId,
                        set: { bio },
                    })
                    .returning({ bio: user_profiles.bio })
            ).at(0)
            if (!updated) throw new Error('Bio update did not return a row')
            return {
                changed: true as const,
                value: { success: true as const, bio: updated.bio },
                oldValues: { bio: previous?.bio ?? null },
                newValues: { bio: updated.bio },
            }
        },
    )
}
