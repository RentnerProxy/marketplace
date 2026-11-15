import { mkdir } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
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
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import type {
    UpdateCurrentUserPersonalInfoInput,
    UpdateCurrentUserProfileImageInput,
} from '@/features/UserSettings/Types/user-settings-server-input.types.ts'

export async function updateCurrentUserProfileImageService(
    data: UpdateCurrentUserProfileImageInput,
) {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const image = await getImageBufferFromDataUrl(data.imageDataUrl)
    const imageBuffer = image.buffer
    const paths = getUserPublicImagePaths(currentUser.id)
    const crop = getSafeImageCrop(data.crop, image)

    const croppedImage = sharp(imageBuffer, {
        limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
    })
        .extract(crop)
        .resize(
            IMAGE_UPLOAD_CONFIG.profile.width,
            IMAGE_UPLOAD_CONFIG.profile.height,
            { fit: 'cover' },
        )

    const operationId = Bun.randomUUIDv7()
    const auditContext = prepareAuditContextService(currentUser.id)
    return withSharedStorageMutationBarrier(async function () {
        await writeStandaloneAuditLogService({
            ...auditContext,
            action: 'user.profile_image_update_started',
            message: 'Änderung des Profilbilds wurde begonnen.',
            newValues: { operationId },
        })
        await mkdir(paths.absoluteDir, { recursive: true })
        await croppedImage
            .webp({ quality: IMAGE_UPLOAD_CONFIG.profile.quality })
            .toFile(paths.absoluteProfile)
        await sharp(imageBuffer, {
            limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
        })
            .extract(crop)
            .resize(
                IMAGE_UPLOAD_CONFIG.profile.thumbnailWidth,
                IMAGE_UPLOAD_CONFIG.profile.thumbnailHeight,
                { fit: 'cover' },
            )
            .webp({ quality: IMAGE_UPLOAD_CONFIG.profile.thumbnailQuality })
            .toFile(paths.absoluteProfileSmall)

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

export async function updateCurrentUserPersonalInfoService(
    data: UpdateCurrentUserPersonalInfoInput,
) {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const personalInfo = {
        firstName: data.firstName.trim() || null,
        lastName: data.lastName.trim() || null,
        street: data.street.trim() || null,
        houseNumber: data.houseNumber.trim() || null,
        postalCode: data.postalCode.trim() || null,
        city: data.city.trim() || null,
    }

    return runAuditedUserSettingsMutationService(
        currentUser.id,
        {
            action: 'user.personal_info_updated',
            message: 'Persönliche Daten wurden aktualisiert.',
        },
        async function (transaction) {
            const previousUsers = await transaction
                .select({
                    firstName: user_profiles.firstName,
                    lastName: user_profiles.lastName,
                    street: user_profiles.street,
                    houseNumber: user_profiles.houseNumber,
                    postalCode: user_profiles.postalCode,
                    city: user_profiles.city,
                })
                .from(user_profiles)
                .where(eq(user_profiles.userId, currentUser.id))
                .limit(1)
            const previous = previousUsers.at(0)
            if (
                previous &&
                previous.firstName === personalInfo.firstName &&
                previous.lastName === personalInfo.lastName &&
                previous.street === personalInfo.street &&
                previous.houseNumber === personalInfo.houseNumber &&
                previous.postalCode === personalInfo.postalCode &&
                previous.city === personalInfo.city
            ) {
                return {
                    changed: false as const,
                    value: { success: true as const, personalInfo },
                }
            }
            const updatedProfiles = await transaction
                .insert(user_profiles)
                .values({ userId: currentUser.id, ...personalInfo })
                .onConflictDoUpdate({
                    target: user_profiles.userId,
                    set: personalInfo,
                })
                .returning({
                    firstName: user_profiles.firstName,
                    lastName: user_profiles.lastName,
                    street: user_profiles.street,
                    houseNumber: user_profiles.houseNumber,
                    postalCode: user_profiles.postalCode,
                    city: user_profiles.city,
                })
            const updated = updatedProfiles.at(0)
            if (!updated) throw new Error('Profile update did not return a row')
            return {
                changed: true as const,
                value: { success: true as const, personalInfo: updated },
                oldValues: previous ?? null,
                newValues: updated,
            }
        },
    )
}
