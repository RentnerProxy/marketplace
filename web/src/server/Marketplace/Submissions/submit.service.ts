import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { and, desc, eq } from 'drizzle-orm'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { db } from '@/db'
import {
    marketplaceRepositoryClaims as claims,
    marketplaceSubmissions as submissions,
} from '@/db/schema.ts'
import type { SubmissionInput } from '@/lib/Marketplace/Types/submission.types.ts'
import { candidateGitHubToken } from './github.service.ts'
import { namespaceRevision } from './namespace.service.ts'
import {
    candidateNamespace,
    readPublicRepository,
    repositoryChallenge,
    verifyRepositoryClaim,
} from './ownership.service.ts'
import {
    auditedSubmissionWrite,
    readClaim,
    submissionAudit,
    SubmissionConflictError,
    submissionEvent,
} from './submission-store.service.ts'

function describeClaim(claim: typeof claims.$inferSelect) {
    return {
        id: claim.id,
        repository: claim.repository,
        namespace: candidateNamespace(claim.ownerId, claim.repositoryId),
        challenge: repositoryChallenge(claim.id),
        path: pipeline.proofPath,
        official: claim.ownerId === pipeline.officialOwnerId,
    }
}

export async function listRepositoryClaimsService(actor: string) {
    const result = await db
        .select()
        .from(claims)
        .where(eq(claims.submitterId, actor))
        .orderBy(desc(claims.createdAt))
        .limit(100)
    return {
        claims: result.map(describeClaim),
        buildsEnabled: Boolean(candidateGitHubToken()),
    }
}

export async function createRepositoryClaimService(
    repository: string,
    actor: string,
) {
    const resolved = await readPublicRepository(repository)
    const result = await auditedSubmissionWrite(actor, async (tx) => {
        const [created] = await tx
            .insert(claims)
            .values({ id: randomUUID(), submitterId: actor, ...resolved })
            .onConflictDoNothing()
            .returning()
        if (created) {
            return {
                result: created,
                audit: {
                    action: 'marketplace.repository.claim_requested',
                    newValues: {
                        repositoryId: created.repositoryId,
                        claimId: created.id,
                    },
                },
            }
        }
        const [existing] = await tx
            .select()
            .from(claims)
            .where(
                and(
                    eq(claims.submitterId, actor),
                    eq(claims.repositoryId, resolved.repositoryId),
                    eq(claims.ownerId, resolved.ownerId),
                    eq(claims.repository, resolved.repository),
                ),
            )
        if (!existing) throw new SubmissionConflictError()
        return { result: existing }
    })
    return describeClaim(result)
}

export async function submitCandidateService(
    request: SubmissionInput,
    actor: string,
) {
    const existing = await findRequest()
    if (existing) return existing

    if (!candidateGitHubToken()) throw new Error('buildsUnavailable')
    const claim = await readClaim(request.claimId, actor)
    await verifyRepositoryClaim(claim, request.commit)

    return auditedSubmissionWrite(actor, async (tx) => {
        const namespace = await namespaceRevision(request.appId, claim, tx)
        const event = submissionEvent(1, 'submitted', actor)
        const [row] = await tx
            .insert(submissions)
            .values({
                id: request.requestId,
                submitterId: actor,
                claimId: claim.id,
                namespaceRevision: namespace,
                request,
                appId: request.appId,
                version: request.version,
                status: event.status,
                history: [event],
                revision: event.revision,
                nextCheckAt: new Date(),
                buildKey: randomUUID(),
            })
            .onConflictDoNothing()
            .returning()

        if (row)
            return {
                result: { id: row.id },
                audit: submissionAudit(row, event),
            }
        const duplicate = await findRequest(tx)
        if (!duplicate) throw new SubmissionConflictError()
        return { result: duplicate }
    })

    async function findRequest(reader: Pick<typeof db, 'select'> = db) {
        const [row] = await reader
            .select({ id: submissions.id, request: submissions.request })
            .from(submissions)
            .where(
                and(
                    eq(submissions.id, request.requestId),
                    eq(submissions.submitterId, actor),
                ),
            )
        if (!row) return null
        if (!isDeepStrictEqual(row.request, request))
            throw new SubmissionConflictError()
        return { id: row.id }
    }
}
