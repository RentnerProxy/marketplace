import { z } from 'zod'
import {
    approval,
    candidate,
    catalogRelease,
    githubId,
    publication,
    revocation,
    sha256,
    timestamp,
} from '@rentnerproxy/app-contracts/schemas'

export type CatalogRevocation = z.output<typeof revocation>

// Revisions and run attempts share the contract's positive safe integer.
const positiveInteger = publication.shape.catalogRevision

export const catalogPublicationPath = '/api/marketplace/v1/catalog-publication'
export const catalogPublisherAudience =
    'rentnerproxy-marketplace-catalog-publisher'
export const catalogPublisherEnvironment = 'app-catalog-publishing'
export const catalogPublisherWorkflow =
    '.github/workflows/app-catalog-publish.yml'

const publicationIdentity = {
    submissionId: z.uuid(),
    approvalRevision: positiveInteger,
}
const priorRun = z.strictObject({ runId: githubId, attempt: positiveInteger })

export const catalogPublicationRequest = z.discriminatedUnion('operation', [
    z.strictObject({ operation: z.literal('queue') }),
    z.strictObject({ operation: z.literal('get'), ...publicationIdentity }),
    z.strictObject({
        operation: z.literal('defer'),
        ...publicationIdentity,
        revision: positiveInteger,
    }),
    z.strictObject({
        operation: z.literal('authorizeDraftCleanup'),
        ...publicationIdentity,
        previousRun: priorRun,
    }),
    z.strictObject({
        operation: z.literal('authorize'),
        ...publicationIdentity,
        previousRun: priorRun.optional(),
    }),
    z.strictObject({
        operation: z.literal('neverPromoted'),
        ...publicationIdentity,
        previousRun: priorRun,
    }),
    z.strictObject({
        operation: z.literal('published'),
        ...publicationIdentity,
        previousRun: priorRun.optional(),
        catalogRevision: positiveInteger,
        publishedAt: timestamp,
        release: catalogRelease,
    }),
    z.strictObject({
        operation: z.literal('confirmRevocation'),
        ...publicationIdentity,
        previousRun: priorRun.optional(),
        catalogRevision: positiveInteger,
        revocation,
    }),
])

const publicationRun = candidate.shape.build
const submissionArtifact = z.strictObject({
    id: githubId,
    sha256,
    sizeBytes: z.int().positive().max(2_147_483_647),
    expiresAt: timestamp,
})
const workStatus = z.enum([
    'approved',
    'publishing',
    'published',
    'withdrawn',
    'revoked',
])

export const catalogPublicationQueue = z.strictObject({
    items: z
        .array(
            z.strictObject({
                ...publicationIdentity,
                revision: positiveInteger,
                kind: z.enum(['publish', 'recover', 'revoke']),
                run: publicationRun.nullable(),
            }),
        )
        .max(20),
})

export const publicationHandoff = z.strictObject({
    approval,
    bundle: submissionArtifact,
    evidence: submissionArtifact,
})

export const catalogPublicationAuthorization = publicationHandoff.extend({
    revision: positiveInteger,
})

export const catalogPublicationWork = publicationHandoff.extend({
    revision: positiveInteger,
    status: workStatus,
    run: publicationRun.nullable(),
    publication: publication.nullable(),
    revocation: revocation.nullable(),
})

export const catalogPublicationStatus = z.strictObject({ status: workStatus })
