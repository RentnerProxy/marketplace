import type { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import type {
    decisionInput,
    stopInput,
} from '@/features/Marketplace/validation.ts'
import { parseApproval } from '../../../../../contracts/v1/index.ts'
import type { SubmissionStatus } from '@/lib/Marketplace/Types/submission.types.ts'
import { assertRetainedCandidate } from './candidate-review.service.ts'
import { InvalidCandidateError } from './candidate-run.service.ts'
import { candidateGitHubToken } from './github-credentials.service.ts'
import { assertCurrentNamespace } from './namespace.service.ts'
import {
    RepositoryOwnershipError,
    verifyRepositoryClaim,
} from './ownership.service.ts'
import {
    auditedSubmissionWrite,
    changeSubmission,
    readClaim,
    readSubmission,
    SubmissionConflictError,
    submissionEvent,
    type Submission,
} from './submission-store.service.ts'

export async function checkCurrentCandidate(row: Submission, token: string) {
    const claim = await readClaim(row.claimId)
    await assertCurrentNamespace(row.appId, claim, row.namespaceRevision)
    await Promise.all([
        assertRetainedCandidate(row, token),
        verifyRepositoryClaim(claim, row.request.commit),
    ])
    return claim
}

export function failureOf(error: unknown) {
    if (error instanceof InvalidCandidateError) return error.reason
    if (error instanceof RepositoryOwnershipError) return 'ownershipChanged'
    return undefined
}

export const expiresOrRecheck = (row: Submission) =>
    new Date(
        Math.min(
            Date.now() + pipeline.recheckMs,
            row.validation
                ? Date.parse(row.validation.bundle.expiresAt)
                : Infinity,
            row.validation
                ? Date.parse(row.validation.evidence.expiresAt)
                : Infinity,
        ),
    )

export async function invalidateSubmission(
    row: Submission,
    error: unknown,
    lease?: Date | null,
) {
    const failure = failureOf(error)
    if (!failure) return
    await auditedSubmissionWrite(null, async (tx) => {
        const current = await readSubmission(row.id, undefined, tx)
        if (
            current.revision !== row.revision ||
            (lease !== undefined &&
                current.nextCheckAt?.getTime() !== lease?.getTime())
        )
            return { result: current }
        const event = submissionEvent(
            row.revision + 1,
            row.publicationRun ? 'revoked' : 'failed',
            null,
            undefined,
            failure,
        )
        return changeSubmission(tx, current, event, { nextCheckAt: null })
    })
}

function repeatedAction(
    row: Submission,
    input: { revision: number; reason: string },
    status: SubmissionStatus,
    actor: string,
) {
    return row.history.some(
        (event) =>
            event.revision === input.revision + 1 &&
            event.status === status &&
            event.actorId === actor &&
            event.reason === input.reason,
    )
}

export async function decideCandidateService(
    input: z.output<typeof decisionInput>,
    actor: string,
    checkActor: () => Promise<void>,
) {
    const row = await readSubmission(input.id)
    const status = input.action === 'approve' ? 'approved' : 'rejected'
    if (row.validation?.candidate.id !== input.candidateId)
        throw new SubmissionConflictError()
    if (repeatedAction(row, input, status, actor)) return { id: row.id }
    if (row.status !== 'awaitingReview' || row.revision !== input.revision) {
        throw new SubmissionConflictError()
    }

    const approvalClaim = await (async () => {
        if (input.action === 'reject') return null
        const token = await candidateGitHubToken()
        if (!token) throw new Error('buildsUnavailable')
        try {
            return await checkCurrentCandidate(row, token)
        } catch (error) {
            await invalidateSubmission(row, error)
            throw error
        }
    })()
    await checkActor()

    try {
        await auditedSubmissionWrite(actor, async (tx) => {
            await requireMutationPermissionService(
                tx,
                actor,
                PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
            )
            const current = await readSubmission(row.id, undefined, tx)
            if (repeatedAction(current, input, status, actor))
                return { result: current }
            if (
                current.status !== 'awaitingReview' ||
                current.revision !== row.revision ||
                current.validation?.candidate.id !== input.candidateId
            )
                throw new SubmissionConflictError()

            const event = submissionEvent(
                current.revision + 1,
                status,
                actor,
                input.reason,
            )
            if (!approvalClaim) {
                return changeSubmission(tx, current, event, {
                    nextCheckAt: null,
                })
            }

            await assertCurrentNamespace(
                row.appId,
                approvalClaim,
                row.namespaceRevision,
                tx,
            )
            if (
                Math.min(
                    Date.parse(current.validation.bundle.expiresAt),
                    Date.parse(current.validation.evidence.expiresAt),
                ) <= Date.now()
            )
                throw new InvalidCandidateError('expiredEvidence')
            const approval = parseApproval({
                formatVersion: 1,
                id: row.id,
                revision: event.revision,
                actorId: actor,
                approvedAt: event.at,
                candidate: current.validation.candidate,
            })
            return changeSubmission(tx, current, event, {
                approval,
                nextCheckAt: expiresOrRecheck(current),
            })
        })
    } catch (error) {
        await invalidateSubmission(row, error)
        throw error
    }
    return { id: row.id }
}

export async function stopSubmissionService(
    input: z.output<typeof stopInput>,
    actor: string,
    action: 'withdrawn' | 'revoked',
) {
    return auditedSubmissionWrite(actor, async (tx) => {
        if (action === 'revoked') {
            await requireMutationPermissionService(
                tx,
                actor,
                PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
            )
        }
        const row = await readSubmission(
            input.id,
            action === 'withdrawn' ? actor : undefined,
            tx,
        )
        if (repeatedAction(row, input, action, actor))
            return { result: { id: row.id } }
        const allowed: SubmissionStatus[] =
            action === 'withdrawn'
                ? [
                      'submitted',
                      'validating',
                      'awaitingReview',
                      'approved',
                      'publishing',
                  ]
                : ['approved', 'publishing', 'published']
        if (row.revision !== input.revision || !allowed.includes(row.status)) {
            throw new SubmissionConflictError()
        }
        const changed = await changeSubmission(
            tx,
            row,
            submissionEvent(row.revision + 1, action, actor, input.reason),
            { nextCheckAt: null },
        )
        return { ...changed, result: { id: row.id } }
    })
}
