import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CANDIDATE_PIPELINE } from '../../../../web/src/config/submissions.config.ts'
import {
    candidateName,
    reportName,
} from '../../../../web/src/lib/Marketplace/candidateEvidence.ts'
import { jsonBytes } from '../../../../web/src/lib/Marketplace/evidenceIdentity.ts'
import { submissionReceipt } from '../../../../web/src/lib/Marketplace/submissionReceipt.ts'
import { readCandidateContext } from './context.ts'
import { metadataLimit, readJson } from './evidence-files.ts'

const [sealedDirectory, out] = process.argv.slice(2)
const context = readCandidateContext(process.env)
if (!sealedDirectory || !out || context.purpose !== 'candidate') {
    throw new Error(
        'Only the Marketplace review workflow can produce a submission receipt',
    )
}

const [candidate, report] = await Promise.all([
    readJson(join(sealedDirectory, candidateName), metadataLimit),
    readJson(join(sealedDirectory, reportName), metadataLimit),
])
const receipt = submissionReceipt.parse({
    submissionId: process.env.SUBMISSION_ID,
    sourcePath: context.request.path,
    bundleId: process.env.BUNDLE_ID,
    bundleSha256: process.env.BUNDLE_DIGEST?.replace(/^sha256:/, ''),
    candidate: candidate.value,
    report: report.value,
})
const bytes = jsonBytes(receipt)
if (bytes.length > CANDIDATE_PIPELINE.evidenceMaxBytes) {
    throw new Error('The submission receipt exceeds its byte budget')
}
await mkdir(out, { recursive: true })
await writeFile(join(out, `submission-${context.build.attempt}.json`), bytes, {
    flag: 'wx',
})
