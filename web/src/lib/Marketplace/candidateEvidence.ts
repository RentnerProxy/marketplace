import { z } from 'zod'
import { packageArtifact } from '../../../../contracts/v1/catalog.ts'
import type { AppManifest, Candidate } from '../../../../contracts/v1/index.ts'
import { candidate } from '../../../../contracts/v1/publication.ts'
import { runNativeTool } from '../Core/native-tool.ts'

export type BuildIdentity = Candidate['build']
export type AppSource = AppManifest['source']
export type AppTarget = AppManifest['target']

const purpose = z.enum(['candidate', 'reference', 'development'])
export type Purpose = z.infer<typeof purpose>

export const candidateName = 'candidate.json'
export const reportName = 'validation-report.json'

export const targetRecord = z.strictObject({
    formatVersion: z.literal(1),
    build: candidate.shape.build,
    purpose,
    applianceImage: z
        .string()
        .max(512)
        .regex(/^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/),
    checks: z.strictObject({
        package: z.literal('passed'),
        securityScan: z.literal('passed'),
        applianceSmoke: z.literal('passed'),
    }),
    package: packageArtifact,
})
export type TargetRecord = z.infer<typeof targetRecord>

export const validationReport = z.strictObject({
    formatVersion: z.literal(1),
    result: z.literal('passed'),
    targets: z.tuple([targetRecord, targetRecord]),
})

export interface TargetExpectation {
    source: AppSource
    build: BuildIdentity
    purpose: Purpose
}

export function assetNames(manifest: AppManifest) {
    const archive = `${manifest.id}-${manifest.version}-${manifest.target}.tar.zst`
    return {
        archive,
        sbom: archive + '.sbom.json',
        provenance: archive + '.provenance.json',
    }
}

export async function assembleCandidate(
    records: [TargetRecord, TargetRecord],
    expected: TargetExpectation,
    publisherName: string,
) {
    const { sealed, reportBytes } = await runNativeTool<{
        sealed: Candidate
        reportBytes: string
    }>('marketplace-app-pipeline', 'evidence-assemble', {
        records,
        ...expected,
        publisherName,
    })
    return { sealed, reportBytes: Buffer.from(reportBytes) }
}
