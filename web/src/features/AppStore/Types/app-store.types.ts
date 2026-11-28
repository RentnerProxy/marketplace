import type { z } from 'zod'
import type { SubmissionStatus } from '@/lib/Marketplace/Types/submission.types.ts'
import type {
    reorderStoreScreenshotsInputSchema,
    storeAppInputSchema,
    storeScreenshotInputSchema,
    updateStoreDescriptionInputSchema,
    uploadStoreImageInputSchema,
} from '../validation.ts'

export type StoreAppInput = z.infer<typeof storeAppInputSchema>
export type UpdateStoreDescriptionInput = z.output<
    typeof updateStoreDescriptionInputSchema
>
export type UploadStoreImageInput = z.infer<typeof uploadStoreImageInputSchema>
export type StoreScreenshotInput = z.infer<typeof storeScreenshotInputSchema>
export type ReorderStoreScreenshotsInput = z.infer<
    typeof reorderStoreScreenshotsInputSchema
>

export type StoreScreenshot = {
    id: string
    src: string
}

/** Store listing as its owner or an admin edits it, also before publication. */
export type StoreEntryEditor = {
    appId: string
    name: string
    status: SubmissionStatus
    isPublished: boolean
    description: string
    logoSrc: string | null
    screenshots: Array<StoreScreenshot>
}

/** One own app in the store entry overview of the developer area. */
export type EditableStoreApp = {
    appId: string
    name: string
    status: SubmissionStatus
    logoSrc: string | null
}

export type StoreMutationResult =
    { success: true } | { success: false; error: string }

export type AppDetailPublisher = {
    id: string
    username: string
    profileImageVersion: number | null
}

/** Public detail page of a published app. */
export type AppDetail = {
    appId: string
    name: string
    summary: string
    license: string
    version: string
    publishedAt: string
    description: string | null
    logoSrc: string | null
    screenshots: Array<StoreScreenshot>
    starCount: number
    isStarred: boolean
    canEdit: boolean
    publisher: AppDetailPublisher | null
}
