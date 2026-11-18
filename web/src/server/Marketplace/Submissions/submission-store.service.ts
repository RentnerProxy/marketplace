import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '@/db'
import {
    marketplaceRepositoryClaims,
    marketplaceSubmissions,
} from '@/db/schema.ts'
import {
    CANDIDATE_PIPELINE as pipeline,
    SUBMISSION_PAGE_SIZE,
} from '@/config/submissions.config.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import type {
    SubmissionEvent,
    SubmissionFailure,
    SubmissionStatus,
} from '@/lib/Marketplace/Types/submission.types.ts'

export type Submission = typeof marketplaceSubmissions.$inferSelect
type SubmissionPatch = Partial<
    Pick<
        Submission,
        | 'nextCheckAt'
        | 'dispatchRequestedAt'
        | 'buildRunId'
        | 'validation'
        | 'approval'
        | 'publicationRun'
        | 'publication'
    >
>

export class SubmissionConflictError extends Error {
    constructor() {
        super('submissionConflict')
    }
}

export function submissionEvent(
    revision: number,
    status: SubmissionStatus,
    actorId: string | null,
    reason?: string,
    failure?: SubmissionFailure,
): SubmissionEvent {
    return {
        revision,
        status,
        at: new Date().toISOString(),
        actorId,
        reason,
        failure,
    }
}

export async function auditedSubmissionWrite<T>(
    actorId: string | null,
    operation: (tx: DatabaseTransaction) => Promise<{
        result: T
        audit?: { action: string; newValues: Record<string, unknown> }
    }>,
) {
    const context = prepareAuditContextService(
        actorId,
        actorId ? {} : { method: 'SYSTEM' },
    )
    const committed = await db.transaction(async (tx) => {
        await lockAuditUsersInTransactionService(tx, [actorId])
        const { result, audit } = await operation(tx)
        const receipt =
            audit &&
            (await writeAuditLogInTransactionService(tx, {
                ...context,
                ...audit,
            }))
        return { result, receipt }
    })
    if (committed.receipt)
        await publishCommittedAuditLogService(committed.receipt)
    return committed.result
}

export function submissionAudit(row: Submission, event: SubmissionEvent) {
    return {
        action: 'marketplace.submission.' + event.status,
        newValues: {
            submissionId: row.id,
            appId: row.appId,
            version: row.version,
            revision: event.revision,
            candidateId: row.validation?.candidate.id,
            buildRunId: row.buildRunId,
            approvalRevision: row.approval?.revision,
            publicationRun: event.publicationRun,
            previousPublicationRun: event.previousPublicationRun,
            catalogRevision: row.publication?.catalogRevision,
            revocation: event.revocation,
            reason: event.reason,
            failure: event.failure,
        },
    }
}

export async function readSubmission(
    id: string,
    submitterId?: string,
    tx?: DatabaseTransaction,
) {
    const query = (tx ?? db)
        .select()
        .from(marketplaceSubmissions)
        .where(
            and(
                eq(marketplaceSubmissions.id, id),
                submitterId
                    ? eq(marketplaceSubmissions.submitterId, submitterId)
                    : undefined,
            ),
        )
    const [row] = tx ? await query.for('update') : await query
    if (!row) throw new SubmissionConflictError()
    return row
}

export async function readClaim(id: string, submitterId?: string) {
    const [claim] = await db
        .select()
        .from(marketplaceRepositoryClaims)
        .where(
            and(
                eq(marketplaceRepositoryClaims.id, id),
                submitterId
                    ? eq(marketplaceRepositoryClaims.submitterId, submitterId)
                    : undefined,
            ),
        )
    if (!claim) throw new SubmissionConflictError()
    return claim
}

export async function changeSubmission(
    tx: DatabaseTransaction,
    row: Submission,
    event: SubmissionEvent,
    patch: SubmissionPatch,
) {
    const [changed] = await tx
        .update(marketplaceSubmissions)
        .set({
            ...patch,
            publicationRetryAt: null,
            status: event.status,
            revision: event.revision,
            history: [...row.history, event],
        })
        .where(eq(marketplaceSubmissions.id, row.id))
        .returning()
    if (!changed) throw new SubmissionConflictError()
    return { result: changed, audit: submissionAudit(changed, event) }
}

export async function leaseDueSubmission() {
    return db.transaction(async (tx) => {
        const now = new Date()
        const [due] = await tx
            .select()
            .from(marketplaceSubmissions)
            .where(lte(marketplaceSubmissions.nextCheckAt, now))
            .orderBy(marketplaceSubmissions.nextCheckAt)
            .limit(1)
            .for('update', { skipLocked: true })
        if (!due) return null

        const nextCheckAt = new Date(now.getTime() + pipeline.leaseMs)
        const [leased] = await tx
            .update(marketplaceSubmissions)
            .set({ nextCheckAt })
            .where(eq(marketplaceSubmissions.id, due.id))
            .returning()
        return leased ?? null
    })
}

export function leaseCondition(row: Submission) {
    if (!row.nextCheckAt) throw new SubmissionConflictError()
    return and(
        eq(marketplaceSubmissions.id, row.id),
        eq(marketplaceSubmissions.revision, row.revision),
        eq(marketplaceSubmissions.nextCheckAt, row.nextCheckAt),
    )
}

export async function listSubmissionsService(
    page: number,
    submitterId?: string,
) {
    const rows = await db
        .select({
            id: marketplaceSubmissions.id,
            appId: marketplaceSubmissions.appId,
            version: marketplaceSubmissions.version,
            status: marketplaceSubmissions.status,
            createdAt: marketplaceSubmissions.createdAt,
        })
        .from(marketplaceSubmissions)
        .where(
            submitterId
                ? eq(marketplaceSubmissions.submitterId, submitterId)
                : undefined,
        )
        .orderBy(
            desc(marketplaceSubmissions.createdAt),
            desc(marketplaceSubmissions.id),
        )
        .limit(SUBMISSION_PAGE_SIZE + 1)
        .offset(page * SUBMISSION_PAGE_SIZE)
    return {
        submissions: rows.slice(0, SUBMISSION_PAGE_SIZE),
        hasMore: rows.length > SUBMISSION_PAGE_SIZE,
    }
}

export async function submissionDetailService(
    id: string,
    submitterId?: string,
) {
    const row = await readSubmission(id, submitterId)
    const { repository } = await readClaim(row.claimId)
    return {
        id: row.id,
        repository,
        request: row.request,
        status: row.status,
        revision: row.revision,
        validation: row.validation,
        buildRunId: row.buildRunId,
        history: row.history.map(
            ({
                actorId,
                publicationRun,
                previousPublicationRun,
                ...event
            }) => ({
                ...event,
                actorId: submitterId ? undefined : actorId,
                publicationRun: submitterId ? undefined : publicationRun,
                previousPublicationRun: submitterId
                    ? undefined
                    : previousPublicationRun,
            }),
        ),
        publication: row.publication,
        revocationPending:
            (row.status === 'withdrawn' || row.status === 'revoked') &&
            Boolean(row.publicationRun || row.publication) &&
            !row.history.some(({ revocation }) => revocation),
    }
}
