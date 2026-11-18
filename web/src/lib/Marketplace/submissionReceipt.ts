import { z } from 'zod'
import { candidate } from '../../../../contracts/v1/publication.ts'
import { githubId, sha256 } from '../../../../contracts/v1/primitives.ts'
import { sourcePath } from './sourceRequest.ts'
import { validationReport } from './candidateEvidence.ts'

export const submissionReceipt = z.strictObject({
    submissionId: z.uuid(),
    sourcePath,
    bundleId: githubId,
    bundleSha256: sha256,
    candidate,
    report: validationReport,
})
