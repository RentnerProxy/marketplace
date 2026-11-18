import { isDeepStrictEqual } from 'node:util'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { marketplaceSubmissions } from '@/db/schema.ts'
import {
    checkApprovalBinding,
    checkPublicationBinding,
    type Catalog,
    type Publication,
} from '../../../../../contracts/v1/index.ts'
import { candidate } from '../../../../../contracts/v1/publication.ts'
import { candidateGitHubToken } from './github.service.ts'
import {
    checkCurrentCandidate,
    expiresOrRecheck,
    invalidateSubmission,
} from './decision.service.ts'
import { InvalidCandidateError } from './candidate-run.service.ts'
import { assertCurrentNamespace } from './namespace.service.ts'
import {
    auditedSubmissionWrite,
    changeSubmission,
    readSubmission,
    SubmissionConflictError,
    submissionEvent,
    type Submission,
} from './submission-store.service.ts'

type PublicationIdentity = {
    submissionId: string
    approvalRevision: number
}
type PublicationAttempt = PublicationIdentity & { run: Publication['run'] }

function requireApproval(row: Submission, approvalRevision: number) {
    if (
        !row.approval ||
        row.approval.revision !== approvalRevision ||
        !row.validation
    ) {
        throw new SubmissionConflictError()
    }
    checkApprovalBinding(row.validation.candidate, row.approval)
    return {
        approval: row.approval,
        bundle: row.validation.bundle,
        evidence: row.validation.evidence,
    }
}

async function validateHandoff(row: Submission) {
    const token = candidateGitHubToken()
    if (!token) throw new Error('buildsUnavailable')
    try {
        return await checkCurrentCandidate(row, token)
    } catch (error) {
        await invalidateSubmission(row, error)
        throw error
    }
}

// Server-only handoff for #5. The protected publisher owns dispatch,
// authenticating its run, verifying the full bundle, and signing the catalog.
export async function listPendingPublicationsService() {
    const rows = await db
        .select({
            submissionId: marketplaceSubmissions.id,
            approval: marketplaceSubmissions.approval,
        })
        .from(marketplaceSubmissions)
        .where(eq(marketplaceSubmissions.status, 'approved'))
        .orderBy(marketplaceSubmissions.createdAt)
        .limit(20)
    return rows.flatMap(({ submissionId, approval }) =>
        approval ? [{ submissionId, approvalRevision: approval.revision }] : [],
    )
}

export async function getApprovedPublicationService(
    input: PublicationIdentity,
) {
    const row = await readSubmission(input.submissionId)
    if (row.status !== 'approved') throw new SubmissionConflictError()
    const handoff = requireApproval(row, input.approvalRevision)
    await validateHandoff(row)
    const current = await readSubmission(row.id)
    if (current.revision !== row.revision) throw new SubmissionConflictError()
    return handoff
}

export async function authorizePublicationAttemptService(
    input: PublicationAttempt,
) {
    const run = candidate.shape.build.parse(input.run)
    const row = await readSubmission(input.submissionId)
    if (row.status !== 'approved' && row.status !== 'publishing')
        throw new SubmissionConflictError()
    const handoff = requireApproval(row, input.approvalRevision)
    const claim = await validateHandoff(row)
    try {
        await auditedSubmissionWrite(null, async (tx) => {
            const current = await readSubmission(row.id, undefined, tx)
            if (
                current.status !== 'approved' &&
                (current.status !== 'publishing' ||
                    !isDeepStrictEqual(current.publicationRun, run))
            )
                throw new SubmissionConflictError()
            requireApproval(current, input.approvalRevision)
            await assertCurrentNamespace(
                row.appId,
                claim,
                row.namespaceRevision,
                tx,
            )
            if (
                [handoff.bundle, handoff.evidence].some(
                    ({ expiresAt }) => Date.parse(expiresAt) <= Date.now(),
                )
            ) {
                throw new InvalidCandidateError('expiredEvidence')
            }
            if (current.status === 'publishing') return { result: current }
            if (
                current.history.some((event) =>
                    isDeepStrictEqual(event.publicationRun, run),
                )
            ) {
                throw new SubmissionConflictError()
            }
            const event = {
                ...submissionEvent(current.revision + 1, 'publishing', null),
                publicationRun: run,
            }
            return changeSubmission(tx, current, event, {
                publicationRun: run,
                nextCheckAt: expiresOrRecheck(current),
            })
        })
    } catch (error) {
        await invalidateSubmission(row, error)
        throw error
    }
    return handoff
}

// Call only from #5's authenticated adapter, after verifying signed catalog
// metadata and public package bytes or proving that the run never promoted.
export async function reconcilePublicationService(
    input: PublicationAttempt,
    outcome:
        | { receipt: Publication; signedCatalog: Catalog }
        | { neverPromoted: true },
) {
    const run = candidate.shape.build.parse(input.run)
    return auditedSubmissionWrite(null, async (tx) => {
        const row = await readSubmission(input.submissionId, undefined, tx)
        const { approval } = requireApproval(row, input.approvalRevision)
        if ('neverPromoted' in outcome) {
            if (
                !row.publicationRun &&
                ['approved', 'revoked', 'withdrawn'].includes(row.status) &&
                row.history.some(
                    (event) =>
                        event.status !== 'publishing' &&
                        isDeepStrictEqual(event.publicationRun, run),
                )
            ) {
                return { result: row.status }
            }
            if (
                !isDeepStrictEqual(row.publicationRun, run) ||
                row.publication
            ) {
                throw new SubmissionConflictError()
            }
            const status = row.status === 'publishing' ? 'approved' : row.status
            const event = {
                ...submissionEvent(row.revision + 1, status, null),
                publicationRun: run,
            }
            const changed = await changeSubmission(tx, row, event, {
                publicationRun: null,
                nextCheckAt:
                    status === 'approved' ? expiresOrRecheck(row) : null,
            })
            return { result: changed.result.status, audit: changed.audit }
        }

        if (!isDeepStrictEqual(row.publicationRun, run))
            throw new SubmissionConflictError()
        const receipt = checkPublicationBinding(
            approval,
            outcome.receipt,
            outcome.signedCatalog,
        )
        if (
            receipt.id !== approval.id ||
            !isDeepStrictEqual(receipt.run, run) ||
            Date.parse(receipt.publishedAt) < Date.parse(approval.approvedAt)
        )
            throw new SubmissionConflictError()
        if (row.publication) {
            if (!isDeepStrictEqual(row.publication, receipt))
                throw new SubmissionConflictError()
            return { result: row.status }
        }

        if (!['publishing', 'withdrawn', 'revoked'].includes(row.status)) {
            throw new SubmissionConflictError()
        }
        // A late receipt can confirm already-signed bytes after withdrawal.
        // Preserve it so the protected publisher can issue a signed revocation.
        const status = row.status === 'publishing' ? 'published' : 'revoked'
        const event = {
            ...submissionEvent(row.revision + 1, status, null),
            publicationRun: run,
        }
        const changed = await changeSubmission(tx, row, event, {
            publication: receipt,
            nextCheckAt: null,
        })
        return { result: changed.result.status, audit: changed.audit }
    })
}
