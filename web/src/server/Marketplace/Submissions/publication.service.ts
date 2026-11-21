import { isDeepStrictEqual } from 'node:util'
import {
    and,
    eq,
    inArray,
    isNotNull,
    isNull,
    lte,
    or,
    sql,
    type SQLWrapper,
} from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { db } from '@/db'
import { marketplaceSubmissions, users } from '@/db/schema.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { CatalogRevocation } from '@/lib/Marketplace/catalogPublication.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import {
    checkApprovalBinding,
    checkPublicationBinding,
    type Catalog,
    type Publication,
} from '../../../../../contracts/v1/index.ts'
import { candidate } from '../../../../../contracts/v1/publication.ts'
import { candidateGitHubToken } from './github-credentials.service.ts'
import {
    assertCatalogPublisherRun,
    assertTerminalCatalogPublisherRunService,
} from './publisher-auth.service.ts'
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
type PriorRun = Pick<Publication['run'], 'runId' | 'attempt'>

function storedSubmissionJson(column: SQLWrapper) {
    // Older Bun SQL writes stored these records as JSONB strings.
    return sql`(case when jsonb_typeof(${column}) = 'string'
        then (${column} #>> '{}')::jsonb else ${column} end)`
}

const storedApprovalRevision = sql<number>`(${storedSubmissionJson(marketplaceSubmissions.approval)}->>'revision')::integer`

function matchesRun(
    run: Publication['run'] | undefined | null,
    expected: PriorRun,
) {
    return run?.runId === expected.runId && run.attempt === expected.attempt
}

function authorizeClaim(
    row: Submission,
    run: Publication['run'],
    previousRun?: PriorRun,
) {
    if (row.status === 'approved' && !previousRun) return null
    if (row.status !== 'publishing' || !row.publicationRun)
        throw new SubmissionConflictError()
    if (isDeepStrictEqual(row.publicationRun, run)) {
        const claim = row.history.findLast(
            (event) =>
                event.status === 'publishing' &&
                isDeepStrictEqual(event.publicationRun, run),
        )
        if (
            previousRun &&
            !matchesRun(claim?.previousPublicationRun, previousRun)
        )
            throw new SubmissionConflictError()
        return null
    }
    if (!previousRun || !matchesRun(row.publicationRun, previousRun))
        throw new SubmissionConflictError()
    return row.publicationRun
}

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
    const token = await candidateGitHubToken()
    if (!token) throw new Error('buildsUnavailable')
    try {
        return await checkCurrentCandidate(row, token)
    } catch (error) {
        await invalidateSubmission(row, error)
        throw error
    }
}

async function isCurrentReviewer(tx: DatabaseTransaction, actorId: string) {
    try {
        await requireMutationPermissionService(
            tx,
            actorId,
            PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
        )
    } catch (error) {
        if (error instanceof PermissionDeniedError) return false
        throw error
    }
    const [actor] = await tx
        .select({ accountType: users.accountType })
        .from(users)
        .where(eq(users.id, actorId))
    return actor?.accountType === 'staff'
}

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

export async function listCatalogPublicationWorkService() {
    const {
        status,
        publicationRun,
        publication,
        createdAt,
        id,
        revision,
    } = marketplaceSubmissions
    const rows = await db
        .select({
            submissionId: id,
            revision,
            approvalRevision: storedApprovalRevision,
            kind: sql<'publish' | 'recover' | 'revoke'>`case
                when ${status} = 'approved' then 'publish'
                when ${publication} is null then 'recover'
                else 'revoke'
            end`,
            run: publicationRun,
        })
        .from(marketplaceSubmissions)
        .where(and(pendingPublicationWork(), publicationWorkIsDue(new Date())))
        .orderBy(
            sql`case when ${status} in ('revoked', 'withdrawn') then 0 when ${status} = 'publishing' then 1 else 2 end`,
            createdAt,
            id,
        )
        .limit(20)
    return rows
}

function pendingPublicationWork() {
    const { approval, history, status, publicationRun, publication } =
        marketplaceSubmissions
    return and(
        isNotNull(approval),
        sql`not (${storedSubmissionJson(history)} @> '[{"revocation":{}}]'::jsonb)`,
        or(
            eq(status, 'approved'),
            and(
                inArray(status, ['publishing', 'withdrawn', 'revoked']),
                isNotNull(publicationRun),
                isNull(publication),
            ),
            and(eq(status, 'revoked'), isNotNull(publication)),
        ),
    )
}

function publicationWorkIsDue(now: Date) {
    const { publicationRetryAt } = marketplaceSubmissions
    return or(isNull(publicationRetryAt), lte(publicationRetryAt, now))
}

export async function deferCatalogPublicationWorkService(
    input: PublicationIdentity & { revision: number },
    caller: Publication['run'],
) {
    assertCatalogPublisherRun(caller)
    const { id, revision, status, publicationRun } = marketplaceSubmissions
    const now = new Date()
    const [deferred] = await db
        .update(marketplaceSubmissions)
        .set({ publicationRetryAt: new Date(now.getTime() + 90 * 60_000) })
        .where(
            and(
                eq(id, input.submissionId),
                or(
                    eq(revision, input.revision),
                    // The authorize response may be lost after committing this caller's claim.
                    and(
                        eq(status, 'publishing'),
                        eq(revision, input.revision + 1),
                        eq(
                            storedSubmissionJson(publicationRun),
                            sql.param(caller, publicationRun),
                        ),
                    ),
                ),
                eq(storedApprovalRevision, input.approvalRevision),
                pendingPublicationWork(),
                publicationWorkIsDue(now),
            ),
        )
        .returning({ status })
    if (!deferred) throw new SubmissionConflictError()
    return deferred.status
}

function stoppedUnpublishedClaim(row: Submission, expected: PriorRun) {
    if (
        (row.status !== 'withdrawn' && row.status !== 'revoked') ||
        row.publication ||
        !row.publicationRun ||
        !matchesRun(row.publicationRun, expected) ||
        row.history.some(({ revocation }) => revocation)
    )
        throw new SubmissionConflictError()
    return { run: row.publicationRun, status: row.status }
}

export async function authorizeDraftCleanupService(
    input: PublicationIdentity & { previousRun: PriorRun },
) {
    const row = await readSubmission(input.submissionId)
    requireApproval(row, input.approvalRevision)
    const { run } = stoppedUnpublishedClaim(row, input.previousRun)
    await assertTerminalCatalogPublisherRunService(run)
    const current = await readSubmission(row.id)
    if (current.revision !== row.revision) throw new SubmissionConflictError()
    return stoppedUnpublishedClaim(current, input.previousRun).status
}

function revocationIntent(row: Submission): CatalogRevocation | null {
    if (row.status !== 'revoked' && row.status !== 'withdrawn') return null
    const stop = row.history.find(
        ({ actorId, failure, status }) =>
            (actorId || failure) &&
            (status === 'revoked' || status === 'withdrawn'),
    )
    if (!stop) throw new SubmissionConflictError()
    return {
        appId: row.appId,
        version: row.version,
        revokedAt: stop.at,
        reason:
            stop.status === 'withdrawn'
                ? 'withdrawn'
                : stop.failure
                  ? 'invalidPublication'
                  : 'security',
    }
}

export async function getCatalogPublicationWorkService(
    input: PublicationIdentity,
) {
    const row = await readSubmission(input.submissionId)
    const handoff = requireApproval(row, input.approvalRevision)
    if (row.status === 'approved') {
        await validateHandoff(row)
        const current = await readSubmission(row.id)
        if (current.revision !== row.revision)
            throw new SubmissionConflictError()
    } else if (!row.publicationRun && !row.publication) {
        throw new SubmissionConflictError()
    }
    return {
        ...handoff,
        revision: row.revision,
        status: row.status,
        run: row.publicationRun,
        publication: row.publication,
        revocation: revocationIntent(row),
    }
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
    input: PublicationAttempt & { previousRun?: PriorRun },
) {
    const run = candidate.shape.build.parse(input.run)
    assertCatalogPublisherRun(run)
    const row = await readSubmission(input.submissionId)
    const handoff = requireApproval(row, input.approvalRevision)
    const prior = authorizeClaim(row, run, input.previousRun)
    if (prior) await assertTerminalCatalogPublisherRunService(prior)
    const claim = await validateHandoff(row)
    try {
        const revision = await auditedSubmissionWrite(null, async (tx) => {
            const allowed = await isCurrentReviewer(
                tx,
                handoff.approval.actorId,
            )
            const current = await readSubmission(row.id, undefined, tx)
            const currentPrior = authorizeClaim(current, run, input.previousRun)
            if (currentPrior && !isDeepStrictEqual(currentPrior, prior))
                throw new SubmissionConflictError()
            requireApproval(current, input.approvalRevision)
            if (!allowed) {
                const event = submissionEvent(
                    current.revision + 1,
                    current.publicationRun ? 'revoked' : 'failed',
                    null,
                    undefined,
                    'approvalRevoked',
                )
                const changed = await changeSubmission(tx, current, event, {
                    nextCheckAt: null,
                })
                return { result: null, audit: changed.audit }
            }
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
            if (isDeepStrictEqual(current.publicationRun, run))
                return { result: current.revision }
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
                previousPublicationRun: currentPrior ?? undefined,
            }
            const changed = await changeSubmission(tx, current, event, {
                publicationRun: run,
                nextCheckAt: expiresOrRecheck(current),
            })
            return { result: changed.result.revision, audit: changed.audit }
        })
        if (revision === null) throw new SubmissionConflictError()
        return { ...handoff, revision }
    } catch (error) {
        await invalidateSubmission(row, error)
        throw error
    }
}

export async function reconcileCatalogPublisherService(
    input: PublicationIdentity,
    caller: Publication['run'],
    outcome:
        | (Pick<Publication, 'catalogRevision' | 'publishedAt' | 'release'> & {
              previousRun?: PriorRun
          })
        | { neverPromoted: true; previousRun: PriorRun },
) {
    const row = await readSubmission(input.submissionId)
    const { approval } = requireApproval(row, input.approvalRevision)
    const expected = outcome.previousRun ?? caller
    const settled =
        'neverPromoted' in outcome && !row.publicationRun
            ? row.history.find(
                  ({ status, publicationRun }) =>
                      status !== 'publishing' &&
                      matchesRun(publicationRun, expected),
              )?.publicationRun
            : undefined
    const run = row.publicationRun ?? settled
    if (!run) throw new SubmissionConflictError()

    const previousRun = !isDeepStrictEqual(run, caller)
    if (outcome.previousRun ? !matchesRun(run, expected) : previousRun)
        throw new SubmissionConflictError()
    if (previousRun && !settled)
        await assertTerminalCatalogPublisherRunService(run)
    if ('neverPromoted' in outcome) {
        if (!previousRun) throw new SubmissionConflictError()
        return reconcilePublicationService({ ...input, run }, outcome)
    }

    const receipt = {
        formatVersion: 1 as const,
        id: approval.id,
        approvalId: approval.id,
        approvalRevision: approval.revision,
        run,
        catalogRevision: outcome.catalogRevision,
        publishedAt: outcome.publishedAt,
        release: outcome.release,
    }
    // The authenticated publisher sends the verified member and catalog
    // revision, so the website never needs the full public catalog in POSTs.
    return reconcilePublicationService(
        { ...input, run },
        {
            receipt,
            signedCatalog: {
                formatVersion: 1,
                revision: outcome.catalogRevision,
                releases: [outcome.release],
                revocations: [],
            },
        },
    )
}

export async function confirmCatalogRevocationService(
    input: PublicationIdentity,
    catalogRevision: number,
    entry: CatalogRevocation,
    previousRun?: PriorRun,
) {
    let terminalRun: Publication['run'] | null = null
    if (previousRun) {
        const row = await readSubmission(input.submissionId)
        requireApproval(row, input.approvalRevision)
        if (
            !row.publicationRun ||
            !matchesRun(row.publicationRun, previousRun) ||
            !isDeepStrictEqual(entry, revocationIntent(row))
        )
            throw new SubmissionConflictError()
        terminalRun = row.publicationRun
        if (
            !row.publication &&
            !row.history.some(({ revocation }) => revocation)
        )
            await assertTerminalCatalogPublisherRunService(terminalRun)
    }
    return auditedSubmissionWrite(null, async (tx) => {
        const row = await readSubmission(input.submissionId, undefined, tx)
        requireApproval(row, input.approvalRevision)
        if (
            (terminalRun &&
                !isDeepStrictEqual(row.publicationRun, terminalRun)) ||
            (row.publication
                ? catalogRevision <= row.publication.catalogRevision
                : !terminalRun) ||
            !isDeepStrictEqual(entry, revocationIntent(row))
        )
            throw new SubmissionConflictError()

        const previous = row.history.find(
            ({ revocation }) => revocation,
        )?.revocation
        if (previous) {
            if (
                catalogRevision < previous.catalogRevision ||
                !isDeepStrictEqual(entry, previous.entry)
            )
                throw new SubmissionConflictError()
            return { result: row.status }
        }
        const changed = await changeSubmission(
            tx,
            row,
            {
                ...submissionEvent(row.revision + 1, 'revoked', null),
                revocation: { catalogRevision, entry },
            },
            {},
        )
        return { result: changed.result.status, audit: changed.audit }
    })
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
        if (
            !row.publication &&
            row.history.some(({ revocation }) => revocation)
        )
            throw new SubmissionConflictError()
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
