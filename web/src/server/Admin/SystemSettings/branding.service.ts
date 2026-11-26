import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { createIcoFromPngBuffer } from '@/lib/Images/ico.ts'
import {
    getImageBufferFromDataUrl,
    getSafeImageCrop,
} from '@/lib/Images/imageDataUrl.ts'
import { getSystemLogoPublicImagePaths } from '@/lib/Images/publicImagePaths.ts'
import { prepareImageVariantSource } from '@/lib/Images/prepareImageVariantSource.ts'
import { publishSystemSettingsUpdatedService } from '@/server/Realtime/publish.service.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import type {
    UpdateCompanyNameInput,
    UpdateSystemLogoInput,
} from '@/features/Admin/SystemSettings/Types/system-settings-server-input.types.ts'
import { getVersion } from './get.service.ts'
import { publishSystemBrandingStorageService } from './branding-storage.service.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import {
    getOrCreateSystemSettingsForUpdateService,
    SYSTEM_SETTINGS_ID,
} from './settings.service.ts'

export async function updateCompanyNameService(
    data: UpdateCompanyNameInput,
    actorUserId: string,
) {
    const companyName = data.companyName.trim()

    if (!companyName) {
        return {
            success: false as const,
            error: 'Firmenname ist erforderlich.',
        }
    }

    const auditContext = prepareAuditContextService(actorUserId)
    const updatedAt = new Date()
    const { settings: committedSettings, auditReceipt: committedReceipt } =
        await db.transaction(async function (tx) {
            await requireMutationPermissionService(
                tx,
                actorUserId,
                PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
            const previousSettings =
                await getOrCreateSystemSettingsForUpdateService(tx)
            const [settings] = await tx
                .update(systemSettings)
                .set({ companyName, updatedAt })
                .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
                .returning()
            if (!settings) {
                throw new Error(
                    'Die Systemeinstellungen konnten nicht aktualisiert werden.',
                )
            }
            const auditReceipt = await writeAuditLogInTransactionService(tx, {
                ...auditContext,
                action: 'admin.system.company_name_updated',
                message: 'Firmenname wurde aktualisiert.',
                oldValues: { companyName: previousSettings.companyName },
                newValues: { companyName: settings.companyName },
            })
            return { settings, auditReceipt }
        })

    await publishCommittedAuditLogService(committedReceipt)
    await runBestEffortSideEffectService(
        'system_settings.company_name_publish_failed',
        function () {
            return publishSystemSettingsUpdatedService({
                companyName: committedSettings.companyName,
                isMaintenanceModeEnabled:
                    committedSettings.isMaintenanceModeEnabled,
                maintenanceStartsAt:
                    committedSettings.maintenanceStartsAt?.toISOString(),
                updatedAt: updatedAt.toISOString(),
            })
        },
    )

    return {
        success: true as const,
        companyName: committedSettings.companyName,
    }
}

export async function updateSystemLogoService(
    data: UpdateSystemLogoInput,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const operationId = Bun.randomUUIDv7()
    const image = await getImageBufferFromDataUrl(
        data.imageDataUrl,
        'Das Logo konnte nicht gelesen werden.',
    )
    const paths = getSystemLogoPublicImagePaths()
    const logoUpdatedAt = new Date()
    const crop = getSafeImageCrop(data.crop, image)

    return withSharedStorageMutationBarrier(async function () {
        const intentReceipt = await db.transaction(async function (tx) {
            await requireMutationPermissionService(
                tx,
                actorUserId,
                PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
            return writeAuditLogInTransactionService(tx, {
                ...auditContext,
                action: 'admin.system.logo_update_started',
                message: 'System-Logo-Aktualisierung wurde begonnen.',
                newValues: { operationId },
            })
        })
        await publishCommittedAuditLogService(intentReceipt)

        const config = IMAGE_UPLOAD_CONFIG.systemLogo
        const createVariant = await prepareImageVariantSource(
            image.buffer,
            crop,
            config.width,
            config.height,
        )
        const [largeLogo, smallLogo, faviconPngBuffer] = await Promise.all([
            createVariant().webp({ quality: config.quality }).toBuffer(),
            createVariant()
                .resize(config.thumbnailWidth, config.thumbnailHeight)
                .webp({ quality: config.thumbnailQuality })
                .toBuffer(),
            createVariant().resize(32, 32).png().toBuffer(),
        ])

        const favicon = createIcoFromPngBuffer(faviconPngBuffer)
        for (const buffer of [largeLogo, smallLogo, favicon]) {
            if (
                buffer.byteLength === 0 ||
                buffer.byteLength > IMAGE_UPLOAD_CONFIG.maxInputBytes
            ) {
                throw new Error('Das Logo konnte nicht gelesen werden.')
            }
        }

        const { settings: committedSettings, auditReceipt: committedReceipt } =
            await db.transaction(async function (tx) {
                await requireMutationPermissionService(
                    tx,
                    actorUserId,
                    PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
                )
                const previousSettings =
                    await getOrCreateSystemSettingsForUpdateService(tx)
                // The actor and settings locks cover replacement of the fixed paths.
                await publishSystemBrandingStorageService(
                    largeLogo,
                    smallLogo,
                    favicon,
                )
                const [settings] = await tx
                    .update(systemSettings)
                    .set({ logoUpdatedAt, updatedAt: logoUpdatedAt })
                    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
                    .returning()
                if (!settings) {
                    throw new Error(
                        'Die Systemeinstellungen konnten nicht aktualisiert werden.',
                    )
                }
                const auditReceipt = await writeAuditLogInTransactionService(
                    tx,
                    {
                        ...auditContext,
                        action: 'admin.system.logo_updated',
                        message: 'System-Logo wurde aktualisiert.',
                        oldValues: {
                            logoUpdatedAt:
                                previousSettings.logoUpdatedAt?.toISOString() ??
                                null,
                        },
                        newValues: {
                            operationId,
                            logoUpdatedAt: logoUpdatedAt.toISOString(),
                        },
                    },
                )
                return { settings, auditReceipt }
            })

        await publishCommittedAuditLogService(committedReceipt)
        const version = getVersion(logoUpdatedAt)
        const logoSrc = `${paths.relativeLarge}?v=${version}`
        const logoSrc64 = `${paths.relativeSmall}?v=${version}`
        const faviconSrc = `${paths.relativeFavicon}?v=${version}`

        await runBestEffortSideEffectService(
            'system_settings.logo_publish_failed',
            function () {
                return publishSystemSettingsUpdatedService({
                    companyName: committedSettings.companyName,
                    logoSrc,
                    logoSrc64,
                    faviconSrc,
                    isMaintenanceModeEnabled:
                        committedSettings.isMaintenanceModeEnabled,
                    maintenanceStartsAt:
                        committedSettings.maintenanceStartsAt?.toISOString(),
                    updatedAt: logoUpdatedAt.toISOString(),
                })
            },
        )

        return {
            success: true as const,
            logoSrc,
            logoSrc64,
            faviconSrc,
        }
    })
}
