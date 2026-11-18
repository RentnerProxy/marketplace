import { setTimeout as delay } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { db } from '@/db'
import { marketplaceSubmissions as submissions } from '@/db/schema.ts'
import type {
    SubmissionFailure,
    ValidatedSubmission,
} from '@/lib/Marketplace/Types/submission.types.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import { readCandidateReview } from './candidate-review.service.ts'
import { dispatchCandidate, findCandidateRun } from './candidate-run.service.ts'
import {
    checkCurrentCandidate,
    expiresOrRecheck,
    failureOf,
    invalidateSubmission,
} from './decision.service.ts'
import { candidateGitHubToken, GitHubRequestError } from './github.service.ts'
import { assertCurrentNamespace } from './namespace.service.ts'
import { verifyRepositoryClaim } from './ownership.service.ts'
import {
    auditedSubmissionWrite,
    changeSubmission,
    leaseCondition,
    leaseDueSubmission,
    readClaim,
    submissionEvent,
    type Submission,
} from './submission-store.service.ts'

async function changeLeased(
    row: Submission,
    result:
        | { status: 'failed'; failure: SubmissionFailure }
        | {
              status: 'awaitingReview'
              validation: ValidatedSubmission
              buildRunId: string
          }
        | { status: 'validating'; requestedAt: Date },
) {
    return auditedSubmissionWrite(null, async (tx) => {
        const [current] = await tx
            .select()
            .from(submissions)
            .where(leaseCondition(row))
            .for('update')
        if (!current) return { result: null }
        const event = submissionEvent(
            current.revision + 1,
            result.status,
            null,
            undefined,
            result.status === 'failed' ? result.failure : undefined,
        )
        if (result.status === 'validating') {
            await tx
                .update(submissions)
                .set({ dispatchRequestedAt: result.requestedAt })
                .where(eq(submissions.id, row.id))
            return changeSubmission(tx, current, event, {})
        }
        if (result.status === 'awaitingReview') {
            return changeSubmission(tx, current, event, {
                nextCheckAt: expiresOrRecheck({
                    ...current,
                    validation: result.validation,
                }),
                validation: result.validation,
                buildRunId: result.buildRunId,
            })
        }
        return changeSubmission(tx, current, event, { nextCheckAt: null })
    })
}

async function checkAgain(
    row: Submission,
    nextCheckAt: Date,
    buildRunId = row.buildRunId,
) {
    await db
        .update(submissions)
        .set({ nextCheckAt, buildRunId })
        .where(leaseCondition(row))
}

async function processSubmission(row: Submission, token: string) {
    if (['awaitingReview', 'approved', 'publishing'].includes(row.status)) {
        try {
            await checkCurrentCandidate(row, token)
        } catch (error) {
            if (!failureOf(error)) throw error
            await invalidateSubmission(row, error)
            return
        }
        await checkAgain(row, expiresOrRecheck(row))
        return
    }
    const elapsed = Date.now() - row.createdAt.getTime()
    if (elapsed >= pipeline.buildTimeoutMs) {
        await changeLeased(row, { status: 'failed', failure: 'buildTimedOut' })
        return
    }

    try {
        const claim = await readClaim(row.claimId)
        if (row.status === 'submitted') {
            await verifyRepositoryClaim(claim, row.request.commit)
            await assertCurrentNamespace(
                row.appId,
                claim,
                row.namespaceRevision,
            )
            const requestedAt = new Date()
            // Record the intent before contacting GitHub. A crashed process may
            // have sent the request, so a successor only discovers the same run.
            const started = await changeLeased(row, {
                status: 'validating',
                requestedAt,
            })
            if (!started) return
            try {
                const runId = await dispatchCandidate(started, claim, token)
                await checkAgain(
                    started,
                    new Date(Date.now() + pipeline.pollMs),
                    runId,
                )
            } catch (error) {
                if (
                    error instanceof GitHubRequestError &&
                    [400, 401, 404, 422].includes(error.status)
                ) {
                    await changeLeased(started, {
                        status: 'failed',
                        failure: 'dispatchFailed',
                    })
                } else {
                    await checkAgain(
                        started,
                        new Date(Date.now() + pipeline.pollMs),
                    )
                }
            }
            return
        }

        const run = await findCandidateRun(row, token)
        const dispatchAge =
            Date.now() - (row.dispatchRequestedAt?.getTime() ?? 0)
        if (!run && dispatchAge >= pipeline.dispatchTimeoutMs) {
            await changeLeased(row, {
                status: 'failed',
                failure: 'dispatchUnconfirmed',
            })
            return
        }
        if (!run || run.status !== 'completed') {
            await checkAgain(
                row,
                new Date(Date.now() + pipeline.pollMs),
                run?.id,
            )
            return
        }
        if (run.conclusion !== 'success') {
            await changeLeased(row, {
                status: 'failed',
                failure: 'buildFailed',
            })
            return
        }
        await verifyRepositoryClaim(claim, row.request.commit)
        await assertCurrentNamespace(row.appId, claim, row.namespaceRevision)
        const validation = await readCandidateReview(row, claim, run, token)
        await changeLeased(row, {
            status: 'awaitingReview',
            validation,
            buildRunId: run.id,
        })
    } catch (error) {
        const failure = failureOf(error)
        if (!failure) throw error
        await changeLeased(row, { status: 'failed', failure })
    }
}

export async function reconcileNextSubmissionService(token: string) {
    const row = await leaseDueSubmission()
    if (row) await processSubmission(row, token)
}

export async function runCandidateValidationWorker(
    signal: AbortSignal,
    isRestoreQuiescenceActive: () => Promise<boolean>,
) {
    const token = candidateGitHubToken()
    if (!token) return
    while (!signal.aborted) {
        // Run one reconciliation at a time. Its durable lease is shared by all workers.
        // oxlint-disable-next-line no-await-in-loop
        await reconcileUnlessRestoring(token)
        try {
            // oxlint-disable-next-line no-await-in-loop
            await delay(pipeline.pollMs, undefined, { signal })
        } catch {
            return
        }
    }

    async function reconcileUnlessRestoring(currentToken: string) {
        try {
            if (!(await isRestoreQuiescenceActive())) {
                await reconcileNextSubmissionService(currentToken)
            }
        } catch {
            logWarn('marketplace.submission.reconcile_unavailable')
        }
    }
}
