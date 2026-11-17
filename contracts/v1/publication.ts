import { z } from 'zod'
import { catalogRelease } from './catalog.ts'
import {
    archive,
    commit,
    formatVersion,
    githubId,
    positiveInteger,
    recordId,
    sourceIdentity,
    timestamp,
} from './primitives.ts'

const workflowRun = z.strictObject({
    repositoryId: githubId,
    workflowCommit: commit,
    workflowPath: z
        .string()
        .max(160)
        .regex(/^\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/),
    runId: githubId,
    attempt: positiveInteger,
})

export const candidate = z
    .strictObject({
        formatVersion,
        id: recordId,
        revision: positiveInteger,
        source: sourceIdentity,
        build: workflowRun,
        evidence: z.strictObject({
            revision: positiveInteger,
            report: archive,
            result: z.literal('passed'),
        }),
        release: catalogRelease,
    })
    .describe(
        'Private candidate snapshot. The validation report and each target archive have their own byte identity. A record claiming success does not establish trusted validation evidence.',
    )

export const approval = z
    .strictObject({
        formatVersion,
        id: recordId,
        revision: positiveInteger,
        actorId: recordId,
        approvedAt: timestamp,
        candidate,
    })
    .describe(
        'Private approval for the entire candidate snapshot, including ordered arrays. Resolve actor permissions and current approval state at the trusted publication boundary.',
    )

export const publication = z
    .strictObject({
        formatVersion,
        id: recordId,
        approvalId: recordId,
        approvalRevision: positiveInteger,
        catalogRevision: positiveInteger,
        publishedAt: timestamp,
        run: workflowRun,
        release: catalogRelease,
    })
    .describe(
        'Private publication receipt. Reconcile by immutable approval revision and exact release contents. Record publication only after the unchanged package bytes and matching signed catalog are available.',
    )
