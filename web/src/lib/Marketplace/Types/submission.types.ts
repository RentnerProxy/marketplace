import type { z } from 'zod'
import type {
    Approval,
    Candidate,
    Publication,
} from '../../../../../contracts/v1/index.ts'
import type { validationReport } from '../candidateEvidence.ts'
import type { submitInput } from '@/features/Marketplace/validation.ts'

export type SubmissionInput = z.output<typeof submitInput>

export type SubmissionStatus =
    | 'submitted'
    | 'validating'
    | 'awaitingReview'
    | 'approved'
    | 'publishing'
    | 'published'
    | 'rejected'
    | 'failed'
    | 'withdrawn'
    | 'revoked'

export type SubmissionFailure =
    | 'dispatchFailed'
    | 'dispatchUnconfirmed'
    | 'buildFailed'
    | 'buildTimedOut'
    | 'invalidEvidence'
    | 'expiredEvidence'
    | 'ownershipChanged'

export type SubmissionArtifact = {
    id: string
    sha256: string
    sizeBytes: number
    expiresAt: string
}

export type ValidatedSubmission = {
    candidate: Candidate
    report: z.output<typeof validationReport>
    bundle: SubmissionArtifact
    evidence: SubmissionArtifact
}

export type SubmissionEvent = {
    revision: number
    status: SubmissionStatus
    at: string
    actorId: string | null
    reason?: string
    failure?: SubmissionFailure
    publicationRun?: PublicationRun
}

export type PublicationRun = Publication['run']
export type SubmissionApproval = Approval
