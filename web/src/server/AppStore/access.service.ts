import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { marketplaceSubmissions } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'

export const STORE_ACCESS_DENIED_MESSAGE =
    'Diesen Store-Eintrag darfst du nicht bearbeiten.'

/** Latest submission of an app, optionally restricted to one submitter. */
export async function readLatestSubmissionService(
    appId: string,
    submitterId: string | null,
) {
    const rows = await db
        .select({
            submitterId: marketplaceSubmissions.submitterId,
            status: marketplaceSubmissions.status,
            request: marketplaceSubmissions.request,
        })
        .from(marketplaceSubmissions)
        .where(
            submitterId
                ? and(
                      eq(marketplaceSubmissions.appId, appId),
                      eq(marketplaceSubmissions.submitterId, submitterId),
                  )
                : eq(marketplaceSubmissions.appId, appId),
        )
        .orderBy(desc(marketplaceSubmissions.createdAt))
        .limit(1)

    return rows.at(0) ?? null
}

export async function isPublishedAppService(appId: string) {
    const rows = await db
        .select({ appId: marketplaceSubmissions.appId })
        .from(marketplaceSubmissions)
        .where(
            and(
                eq(marketplaceSubmissions.appId, appId),
                eq(marketplaceSubmissions.status, 'published'),
            ),
        )
        .limit(1)

    return rows.length > 0
}

/**
 * Owners (accounts that submitted the app id through their repository claim)
 * and marketplace reviewers may edit a listing, in any submission status.
 */
export async function resolveStoreEditorService(appId: string) {
    const { sessionUser, permissionKeys } =
        await requireAuthenticatedFeatureAccessService()
    const isReviewer = hasPermission(
        permissionKeys,
        PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
    )
    const ownSubmission = await readLatestSubmissionService(
        appId,
        sessionUser.id,
    )
    const submission =
        ownSubmission ??
        (isReviewer ? await readLatestSubmissionService(appId, null) : null)

    if (!submission) {
        return null
    }

    return {
        actorId: sessionUser.id,
        latestOwnOrAnySubmission: submission,
    }
}
