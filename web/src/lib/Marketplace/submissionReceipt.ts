import { z } from 'zod'
import {
    candidate,
    githubId,
    sha256,
} from '@rentnerproxy/app-contracts/schemas'
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
