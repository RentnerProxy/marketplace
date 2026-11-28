import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
    app_store_entries,
    app_store_screenshots,
    marketplaceSubmissions,
} from '@/db/schema.ts'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import type {
    EditableStoreApp,
    ReorderStoreScreenshotsInput,
    StoreAppInput,
    StoreEntryEditor,
    StoreMutationResult,
    StoreScreenshot,
    StoreScreenshotInput,
    UpdateStoreDescriptionInput,
    UploadStoreImageInput,
} from '@/features/AppStore/Types/app-store.types.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { auditedSubmissionWrite } from '@/server/Marketplace/Submissions/submission-store.service.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import {
    isPublishedAppService,
    resolveStoreEditorService,
    STORE_ACCESS_DENIED_MESSAGE,
} from './access.service.ts'
import {
    encodeStoreImageService,
    getStoreImageSrc,
    removeStoreImageFilesService,
    STORE_IMAGE_ERROR_MESSAGE,
    writeStoreImageFileService,
} from './images.service.ts'

const denied: StoreMutationResult = {
    success: false,
    error: STORE_ACCESS_DENIED_MESSAGE,
}

class StoreLimitError extends Error {}

export async function readStoreListingService(appId: string) {
    const [entry, screenshots] = await Promise.all([
        db
            .select({
                description: app_store_entries.description,
                logoFileId: app_store_entries.logoFileId,
            })
            .from(app_store_entries)
            .where(eq(app_store_entries.appId, appId))
            .limit(1),
        db
            .select({ id: app_store_screenshots.id })
            .from(app_store_screenshots)
            .where(eq(app_store_screenshots.appId, appId))
            .orderBy(
                asc(app_store_screenshots.position),
                asc(app_store_screenshots.createdAt),
            ),
    ])
    const row = entry.at(0)

    return {
        description: row?.description ?? null,
        logoSrc: getStoreImageSrc(appId, row?.logoFileId ?? null),
        screenshots: screenshots.map((screenshot): StoreScreenshot => ({
            id: screenshot.id,
            src: getStoreImageSrc(appId, screenshot.id) ?? '',
        })),
    }
}

export async function getStoreEntryEditorService(
    input: StoreAppInput,
): Promise<StoreEntryEditor | null> {
    const editor = await resolveStoreEditorService(input.appId)

    if (!editor) {
        return null
    }

    const [listing, isPublished] = await Promise.all([
        readStoreListingService(input.appId),
        isPublishedAppService(input.appId),
    ])
    const submission = editor.latestOwnOrAnySubmission

    return {
        appId: input.appId,
        name: submission.request.display.name,
        status: submission.status,
        isPublished,
        description: listing.description ?? '',
        logoSrc: listing.logoSrc,
        screenshots: listing.screenshots,
    }
}

/** Own app ids with their latest submission, for the developer overview. */
export async function listEditableStoreAppsService(
    userId: string,
): Promise<Array<EditableStoreApp>> {
    const rows = await db
        .selectDistinctOn([marketplaceSubmissions.appId], {
            appId: marketplaceSubmissions.appId,
            status: marketplaceSubmissions.status,
            request: marketplaceSubmissions.request,
            logoFileId: app_store_entries.logoFileId,
        })
        .from(marketplaceSubmissions)
        .leftJoin(
            app_store_entries,
            eq(app_store_entries.appId, marketplaceSubmissions.appId),
        )
        .where(eq(marketplaceSubmissions.submitterId, userId))
        .orderBy(
            marketplaceSubmissions.appId,
            desc(marketplaceSubmissions.createdAt),
        )
        .limit(APP_STORE_CONFIG.catalogLimit)

    return rows.map((row) => ({
        appId: row.appId,
        name: row.request.display.name,
        status: row.status,
        logoSrc: getStoreImageSrc(row.appId, row.logoFileId),
    }))
}

async function ensureEntry(
    tx: DatabaseTransaction,
    appId: string,
    actorId: string,
) {
    const rows = await tx
        .insert(app_store_entries)
        .values({ appId, updatedBy: actorId })
        .onConflictDoUpdate({
            target: app_store_entries.appId,
            set: { updatedAt: sql`now()`, updatedBy: actorId },
        })
        .returning({ logoFileId: app_store_entries.logoFileId })

    return rows.at(0)?.logoFileId ?? null
}

export async function updateStoreDescriptionService(
    input: UpdateStoreDescriptionInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    const description = input.description || null
    await auditedSubmissionWrite(editor.actorId, async (tx) => {
        await ensureEntry(tx, input.appId, editor.actorId)
        await tx
            .update(app_store_entries)
            .set({ description })
            .where(eq(app_store_entries.appId, input.appId))
        return {
            result: null,
            audit: {
                action: 'marketplace.store.description_updated',
                newValues: {
                    appId: input.appId,
                    length: description?.length ?? 0,
                },
            },
        }
    })

    return { success: true }
}

export async function uploadStoreLogoService(
    input: UploadStoreImageInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    const image = await encodeStoreImageService(
        input.imageDataUrl,
        input.crop,
        'logo',
    )
    if (!image) return { success: false, error: STORE_IMAGE_ERROR_MESSAGE }

    const fileId = Bun.randomUUIDv7()
    return withSharedStorageMutationBarrier(async function () {
        await writeStoreImageFileService(input.appId, fileId, image)
        let previousFileId: string | null = null
        try {
            previousFileId = await auditedSubmissionWrite(
                editor.actorId,
                async (tx) => {
                    const previous = await ensureEntry(
                        tx,
                        input.appId,
                        editor.actorId,
                    )
                    await tx
                        .update(app_store_entries)
                        .set({ logoFileId: fileId })
                        .where(eq(app_store_entries.appId, input.appId))
                    return {
                        result: previous,
                        audit: {
                            action: 'marketplace.store.logo_updated',
                            newValues: { appId: input.appId, fileId },
                        },
                    }
                },
            )
        } catch (error) {
            await removeStoreImageFilesService(input.appId, [fileId])
            throw error
        }

        if (previousFileId) {
            await removeStoreImageFilesService(input.appId, [previousFileId])
        }
        return { success: true as const }
    })
}

export async function removeStoreLogoService(
    input: StoreAppInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    return withSharedStorageMutationBarrier(async function () {
        const previousFileId = await auditedSubmissionWrite(
            editor.actorId,
            async (tx) => {
                const previous = await ensureEntry(
                    tx,
                    input.appId,
                    editor.actorId,
                )
                await tx
                    .update(app_store_entries)
                    .set({ logoFileId: null })
                    .where(eq(app_store_entries.appId, input.appId))
                return {
                    result: previous,
                    audit: previous
                        ? {
                              action: 'marketplace.store.logo_removed',
                              newValues: {
                                  appId: input.appId,
                                  fileId: previous,
                              },
                          }
                        : undefined,
                }
            },
        )

        if (previousFileId) {
            await removeStoreImageFilesService(input.appId, [previousFileId])
        }
        return { success: true as const }
    })
}

export async function addStoreScreenshotService(
    input: UploadStoreImageInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    const image = await encodeStoreImageService(
        input.imageDataUrl,
        input.crop,
        'screenshot',
    )
    if (!image) return { success: false, error: STORE_IMAGE_ERROR_MESSAGE }

    const screenshotId = Bun.randomUUIDv7()
    return withSharedStorageMutationBarrier(async function () {
        await writeStoreImageFileService(input.appId, screenshotId, image)
        try {
            await auditedSubmissionWrite(editor.actorId, async (tx) => {
                await ensureEntry(tx, input.appId, editor.actorId)
                // The entry row lock from the upsert serializes concurrent uploads.
                const existing = (
                    await tx
                        .select({ value: count() })
                        .from(app_store_screenshots)
                        .where(eq(app_store_screenshots.appId, input.appId))
                ).at(0)?.value
                const position = existing ?? 0

                if (position >= APP_STORE_CONFIG.maxScreenshots) {
                    throw new StoreLimitError()
                }

                await tx.insert(app_store_screenshots).values({
                    id: screenshotId,
                    appId: input.appId,
                    position,
                })
                return {
                    result: null,
                    audit: {
                        action: 'marketplace.store.screenshot_added',
                        newValues: { appId: input.appId, screenshotId },
                    },
                }
            })
        } catch (error) {
            await removeStoreImageFilesService(input.appId, [screenshotId])
            if (error instanceof StoreLimitError) {
                return {
                    success: false as const,
                    error: `Es sind höchstens ${APP_STORE_CONFIG.maxScreenshots} Screenshots erlaubt.`,
                }
            }
            throw error
        }

        return { success: true as const }
    })
}

async function renumberScreenshots(
    tx: DatabaseTransaction,
    appId: string,
    orderedIds: Array<string>,
) {
    if (orderedIds.length === 0) return

    const positions = sql.join(
        orderedIds.map(
            (id, position) =>
                sql`when ${app_store_screenshots.id} = ${id} then ${position}::integer`,
        ),
        sql` `,
    )
    await tx
        .update(app_store_screenshots)
        .set({ position: sql`case ${positions} end` })
        .where(
            and(
                eq(app_store_screenshots.appId, appId),
                inArray(app_store_screenshots.id, orderedIds),
            ),
        )
}

async function readOrderedScreenshotIds(
    tx: DatabaseTransaction,
    appId: string,
) {
    const rows = await tx
        .select({ id: app_store_screenshots.id })
        .from(app_store_screenshots)
        .where(eq(app_store_screenshots.appId, appId))
        .orderBy(
            asc(app_store_screenshots.position),
            asc(app_store_screenshots.createdAt),
        )
    return rows.map((row) => row.id)
}

export async function removeStoreScreenshotService(
    input: StoreScreenshotInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    return withSharedStorageMutationBarrier(async function () {
        const removed = await auditedSubmissionWrite(
            editor.actorId,
            async (tx) => {
                await ensureEntry(tx, input.appId, editor.actorId)
                const deleted = await tx
                    .delete(app_store_screenshots)
                    .where(
                        and(
                            eq(app_store_screenshots.appId, input.appId),
                            eq(app_store_screenshots.id, input.screenshotId),
                        ),
                    )
                    .returning({ id: app_store_screenshots.id })

                if (deleted.length === 0) {
                    return { result: false }
                }

                await renumberScreenshots(
                    tx,
                    input.appId,
                    await readOrderedScreenshotIds(tx, input.appId),
                )
                return {
                    result: true,
                    audit: {
                        action: 'marketplace.store.screenshot_removed',
                        newValues: {
                            appId: input.appId,
                            screenshotId: input.screenshotId,
                        },
                    },
                }
            },
        )

        if (removed) {
            await removeStoreImageFilesService(input.appId, [
                input.screenshotId,
            ])
        }
        return { success: true as const }
    })
}

export async function reorderStoreScreenshotsService(
    input: ReorderStoreScreenshotsInput,
): Promise<StoreMutationResult> {
    const editor = await resolveStoreEditorService(input.appId)
    if (!editor) return denied

    const reordered = await auditedSubmissionWrite(
        editor.actorId,
        async (tx) => {
            await ensureEntry(tx, input.appId, editor.actorId)
            const current = await readOrderedScreenshotIds(tx, input.appId)
            const requested = new Set(input.screenshotIds)

            if (
                current.length !== requested.size ||
                current.some((id) => !requested.has(id))
            ) {
                return { result: false }
            }

            await renumberScreenshots(tx, input.appId, input.screenshotIds)
            return {
                result: true,
                audit: {
                    action: 'marketplace.store.screenshots_reordered',
                    newValues: {
                        appId: input.appId,
                        screenshotIds: input.screenshotIds,
                    },
                },
            }
        },
    )

    return reordered
        ? { success: true }
        : {
              success: false,
              error: 'Die Screenshots haben sich zwischenzeitlich geändert. Bitte lade die Seite neu.',
          }
}
