import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { db } from '@/db'
import {
    marketplaceOfficialApps,
    marketplaceRepositoryClaims,
} from '@/db/schema.ts'
import type { officialAppInput } from '@/features/Marketplace/validation.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import {
    candidateNamespace,
    RepositoryOwnershipError,
    verifyRepositoryClaim,
} from './ownership.service.ts'
import {
    auditedSubmissionWrite,
    readClaim,
    SubmissionConflictError,
} from './submission-store.service.ts'

type Claim = typeof marketplaceRepositoryClaims.$inferSelect

export async function namespaceRevision(
    appId: string,
    claim: Claim,
    tx?: DatabaseTransaction,
) {
    const namespace = appId.split('.')[0]
    if (namespace !== pipeline.officialNamespace) {
        if (namespace !== candidateNamespace(claim.ownerId, claim.repositoryId))
            throw new RepositoryOwnershipError()
        return null
    }

    if (claim.ownerId !== pipeline.officialOwnerId)
        throw new RepositoryOwnershipError()
    const query = (tx ?? db)
        .select()
        .from(marketplaceOfficialApps)
        .where(eq(marketplaceOfficialApps.appId, appId))
    const [assignment] = tx ? await query.for('share') : await query
    if (!assignment || assignment.claimId !== claim.id)
        throw new RepositoryOwnershipError()
    return assignment.revision
}

export async function assertCurrentNamespace(
    appId: string,
    claim: Claim,
    revision: number | null,
    tx?: DatabaseTransaction,
) {
    if ((await namespaceRevision(appId, claim, tx)) !== revision) {
        throw new RepositoryOwnershipError()
    }
}

export async function changeOfficialAppService(
    input: z.output<typeof officialAppInput>,
    actor: string,
) {
    const { appId, claimId, revision } = input
    if (claimId) {
        const claim = await readClaim(claimId)
        if (claim.ownerId !== pipeline.officialOwnerId)
            throw new RepositoryOwnershipError()
        await verifyRepositoryClaim(claim)
    }
    return auditedSubmissionWrite(actor, async (tx) => {
        const [current] = await tx
            .select()
            .from(marketplaceOfficialApps)
            .where(eq(marketplaceOfficialApps.appId, appId))
            .for('update')
        if (current?.revision === revision + 1 && current.claimId === claimId)
            return { result: current }
        if ((current?.revision ?? 0) !== revision || (!current && !claimId)) {
            throw new SubmissionConflictError()
        }
        if (current?.claimId === claimId) return { result: current }
        const values = { claimId, revision: revision + 1 }
        const [assignment] = current
            ? await tx
                  .update(marketplaceOfficialApps)
                  .set(values)
                  .where(eq(marketplaceOfficialApps.appId, appId))
                  .returning()
            : await tx
                  .insert(marketplaceOfficialApps)
                  .values({ appId, ...values })
                  .onConflictDoNothing()
                  .returning()

        if (!assignment) throw new SubmissionConflictError()
        return {
            result: assignment,
            audit: {
                action: 'marketplace.namespace.changed',
                newValues: {
                    appId,
                    claimId,
                    previousClaimId: current?.claimId,
                    revision: assignment.revision,
                },
            },
        }
    })
}

export async function listOfficialAppsService() {
    return db
        .select()
        .from(marketplaceOfficialApps)
        .orderBy(marketplaceOfficialApps.appId)
}
