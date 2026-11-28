import { z } from 'zod'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import { repositoryName, sourcePath } from '@/lib/Marketplace/sourceRequest.ts'
import {
    appId,
    appManifest,
    appVersion,
    catalogRelease,
    commit,
    sha256,
} from '@rentnerproxy/app-contracts/schemas'

const id = z.uuid()
const publisherDisplayName = catalogRelease.shape.publisher.shape.name
const revision = z.number().int().min(1).max(2147483647)
const reason = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^(?:[^\p{Cc}\p{Cs}]|\n)+$/u)

export const claimInput = z.strictObject({
    repository: repositoryName,
})

export const submitInput = z
    .strictObject({
        requestId: id,
        claimId: id,
        commit,
        path: sourcePath,
        appId,
        version: appVersion,
        targets: z.tuple([
            z.literal(CANDIDATE_PIPELINE.targets[0]),
            z.literal(CANDIDATE_PIPELINE.targets[1]),
        ]),
        publisherName: z.string().trim().pipe(publisherDisplayName),
        display: appManifest.shape.display,
        configSchema: appManifest.shape.configSchema,
    })
    .transform(({ configSchema, ...data }) => ({
        ...data,
        ...(configSchema ? { configSchema } : {}),
    }))

export const listInput = z.strictObject({
    page: z.number().int().min(0).max(1000),
})

export const detailInput = z.strictObject({ id })

export const decisionInput = detailInput.extend({
    revision,
    candidateId: sha256,
    reason,
    action: z.enum(['approve', 'reject']),
})

export const stopInput = detailInput.extend({ revision, reason })

export const officialAppInput = z.strictObject({
    appId: appId.refine((value) =>
        value.startsWith(CANDIDATE_PIPELINE.officialNamespace + '.'),
    ),
    claimId: id.nullable(),
    revision: z.number().int().min(0).max(2147483647),
})
