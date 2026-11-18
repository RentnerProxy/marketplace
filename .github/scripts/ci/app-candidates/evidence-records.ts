import { z } from 'zod'
import { packageArtifact } from '../../../../contracts/v1/catalog.ts'
import {
    parseAppManifest,
    parseCandidate,
    type AppManifest,
    type Candidate,
} from '../../../../contracts/v1/index.ts'
import {
    displayName,
    githubId,
    positiveInteger,
    sha256,
    sourceIdentity,
    timestamp,
} from '../../../../contracts/v1/primitives.ts'
import { candidate } from '../../../../contracts/v1/publication.ts'
import { byteIdentity, jsonBytes } from './evidence-files.ts'

export type BuildIdentity = Candidate['build']
export type AppSource = AppManifest['source']
export type AppTarget = AppManifest['target']

const purpose = z.enum(['candidate', 'reference', 'development'])
export type Purpose = z.infer<typeof purpose>

export const targets = ['linux-amd64', 'linux-arm64'] as const
export const targetRecordName = 'target.json'
export const candidateName = 'candidate.json'
export const reportName = 'validation-report.json'

const buildIdentity = candidate.shape.build
const appliance = z
    .string()
    .max(512)
    .regex(/^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/)

const passedChecks = z.strictObject({
    package: z.literal('passed'),
    securityScan: z.literal('passed'),
    applianceSmoke: z.literal('passed'),
})
const targetContext = z.strictObject({
    formatVersion: z.literal(1),
    build: buildIdentity,
    purpose,
    applianceImage: appliance,
    checks: passedChecks,
})
export const targetRecord = targetContext.extend({ package: packageArtifact })
export type TargetRecord = z.infer<typeof targetRecord>

export function checkedTargetContext(options: {
    build: BuildIdentity
    purpose: Purpose
    applianceImage: string
}) {
    return targetContext.parse({
        formatVersion: 1,
        build: options.build,
        purpose: options.purpose,
        applianceImage: options.applianceImage,
        checks: {
            package: 'passed',
            securityScan: 'passed',
            applianceSmoke: 'passed',
        },
    })
}

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

export function provenanceBytes(
    context: z.infer<typeof targetContext>,
    asset: Omit<TargetRecord['package'], 'provenance'>,
) {
    return jsonBytes({
        formatVersion: context.formatVersion,
        build: context.build,
        purpose: context.purpose,
        applianceImage: context.applianceImage,
        checks: context.checks,
        appId: asset.manifest.id,
        version: asset.manifest.version,
        target: asset.manifest.target,
        source: asset.manifest.source,
        manifestSha256: asset.manifestSha256,
        archive: asset.archive,
        sbom: asset.sbom,
    })
}

export function assertTarget(
    record: TargetRecord,
    expected: TargetExpectation,
    target: AppTarget,
) {
    const { manifest } = record.package
    parseAppManifest(manifest)
    if (
        manifest.target !== target ||
        manifest.source.repositoryId !== expected.source.repositoryId ||
        manifest.source.commit !== expected.source.commit ||
        !jsonBytes(record.build).equals(jsonBytes(expected.build)) ||
        record.purpose !== expected.purpose
    ) {
        throw new Error(
            'Candidate target source, build, purpose, or platform mismatch',
        )
    }
}

export function checkedExpectation(
    expected: TargetExpectation,
): TargetExpectation {
    return {
        source: sourceIdentity.parse(expected.source),
        build: buildIdentity.parse(expected.build),
        purpose: purpose.parse(expected.purpose),
    }
}

export function assembleCandidate(
    records: [TargetRecord, TargetRecord],
    expected: TargetExpectation,
    publisherName: string,
) {
    const [first, second] = records
    assertTarget(first, expected, targets[0])
    assertTarget(second, expected, targets[1])
    if (first.applianceImage !== second.applianceImage) {
        throw new Error(
            'Candidate targets used different appliance image references',
        )
    }
    const report = validationReport.parse({
        formatVersion: 1,
        result: 'passed',
        targets: records,
    })
    const reportBytes = jsonBytes(report)
    const { id: appId, version } = first.package.manifest
    const body = {
        source: expected.source,
        build: expected.build,
        evidence: {
            revision: 1,
            report: byteIdentity(reportBytes),
            result: 'passed',
        },
        release: {
            appId,
            version,
            source: expected.source,
            publisher: {
                namespace: appId.split('.')[0],
                name: displayName.parse(publisherName),
            },
            packages: records.map((record) => record.package),
        },
    }
    const sealed = parseCandidate({
        formatVersion: 1,
        id: byteIdentity(jsonBytes(body)).sha256,
        revision: 1,
        ...body,
    })
    return { sealed, reportBytes }
}

const artifactIdentity = z.strictObject({ id: githubId, sha256 })
export const artifactReceipt = artifactIdentity.extend({
    expiresAt: timestamp,
    expired: z.boolean(),
})
export const downloadedIdentity = artifactIdentity

const boundedList = z.array(z.unknown()).max(16_384)
const bom = z.object({
    bomFormat: z.literal('CycloneDX'),
    specVersion: z.string().regex(/^1\.[0-7]$/),
    version: positiveInteger,
    components: boundedList,
    dependencies: boundedList.optional(),
    vulnerabilities: boundedList.optional(),
    services: boundedList.optional(),
    metadata: z.object({ component: z.unknown().optional() }).optional(),
})
const component = z.object({
    name: z.string().min(1).max(4096),
    type: z.string().min(1).max(64),
    components: boundedList.optional(),
})

export function verifySbom(value: unknown) {
    const parsed = bom.parse(value)
    const pending = parsed.components.slice()
    if (parsed.metadata?.component !== undefined)
        pending.push(parsed.metadata.component)
    let count = pending.length
    if (count > 16_384)
        throw new Error('Candidate SBOM has too many components')
    while (pending.length > 0) {
        const entry = component.parse(pending.pop())
        if (!entry.components) continue
        count += entry.components.length
        if (count > 16_384)
            throw new Error('Candidate SBOM has too many components')
        pending.push(...entry.components)
    }
}
