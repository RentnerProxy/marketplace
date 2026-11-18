import { join } from 'node:path'
import {
    parseAppManifest,
    parseCandidate,
    type AppManifest,
} from '../../../../contracts/v1/index.ts'
import { sha256 } from '../../../../contracts/v1/primitives.ts'
import {
    assertDirectory,
    byteIdentity,
    checkDirectory,
    copyAsset,
    evidenceLimit,
    fileIdentity,
    jsonBytes,
    metadataLimit,
    packageLimit,
    prepareOutput,
    readJson,
    saveMetadata,
} from './evidence-files.ts'
import {
    artifactReceipt,
    assembleCandidate,
    assertTarget,
    assetNames,
    candidateName,
    checkedExpectation,
    checkedTargetContext,
    downloadedIdentity,
    provenanceBytes,
    reportName,
    targetRecord,
    targetRecordName,
    targets,
    validationReport,
    verifySbom,
    type AppSource,
    type AppTarget,
    type BuildIdentity,
    type Purpose,
    type TargetExpectation,
    type TargetRecord,
} from './evidence-records.ts'

export type { BuildIdentity, Purpose } from './evidence-records.ts'

function assetsFor(record: TargetRecord) {
    const names = assetNames(record.package.manifest)
    return [
        {
            name: names.archive,
            identity: record.package.archive,
            limit: packageLimit,
        },
        {
            name: names.sbom,
            identity: record.package.sbom,
            limit: evidenceLimit,
        },
        {
            name: names.provenance,
            identity: record.package.provenance,
            limit: metadataLimit,
        },
    ] as const
}

async function verifyAssets(directory: string, record: TargetRecord) {
    const [archive, sbom, provenance] = assetsFor(record)
    const [, sbomContents, provenanceContents] = await Promise.all([
        fileIdentity(
            join(directory, archive.name),
            archive.limit,
            archive.identity,
        ),
        readJson(join(directory, sbom.name), sbom.limit, sbom.identity),
        readJson(
            join(directory, provenance.name),
            provenance.limit,
            provenance.identity,
        ),
    ])
    verifySbom(sbomContents.value)
    if (
        !provenanceContents.bytes.equals(
            provenanceBytes(record, record.package),
        )
    ) {
        throw new Error('Candidate provenance does not match target evidence')
    }
}

interface SealTargetOptions {
    outputDirectory: string
    archivePath: string
    sbomPath: string
    manifest: AppManifest
    manifestSha256: string
    build: BuildIdentity
    purpose: Purpose
    applianceImage: string
}

// Invoke only after the trusted job has validated, scanned and smoke-tested
// these exact bytes. Input paths and the output directory are owned by that job.
export async function sealTarget(options: SealTargetOptions) {
    const { archivePath, sbomPath, outputDirectory } = options
    const context = checkedTargetContext(options)
    const manifest = parseAppManifest(options.manifest)
    const manifestSha256 = sha256.parse(options.manifestSha256)
    const [archive, sbomContents] = await Promise.all([
        fileIdentity(archivePath, packageLimit),
        readJson(sbomPath, evidenceLimit),
    ])
    verifySbom(sbomContents.value)
    const pkg = {
        manifest,
        manifestSha256,
        archive,
        sbom: byteIdentity(sbomContents.bytes),
    }
    const provenance = provenanceBytes(context, pkg)
    const record = targetRecord.parse({
        ...context,
        package: { ...pkg, provenance: byteIdentity(provenance) },
    })
    const names = assetNames(manifest)
    const files = [targetRecordName, ...Object.values(names)]
    await prepareOutput(outputDirectory, files)
    await copyAsset(
        archivePath,
        join(outputDirectory, names.archive),
        archive,
        packageLimit,
    )
    await copyAsset(
        sbomPath,
        join(outputDirectory, names.sbom),
        pkg.sbom,
        evidenceLimit,
    )
    await saveMetadata(outputDirectory, names.provenance, provenance)
    await saveMetadata(outputDirectory, targetRecordName, jsonBytes(record))
    await checkDirectory(outputDirectory, files)
    return record
}

interface SealCandidateOptions extends TargetExpectation {
    outputDirectory: string
    targetDirectories: Record<AppTarget, string>
    publisherName: string
}

async function loadTarget(
    directory: string,
    expected: TargetExpectation,
    target: AppTarget,
) {
    await assertDirectory(directory)
    const { bytes, value } = await readJson(
        join(directory, targetRecordName),
        metadataLimit,
    )
    const record = targetRecord.parse(value)
    assertTarget(record, expected, target)
    if (!bytes.equals(jsonBytes(record)))
        throw new Error(
            'Candidate target record differs from its canonical seal',
        )
    await checkDirectory(directory, [
        targetRecordName,
        ...Object.values(assetNames(record.package.manifest)),
    ])
    return record
}

export async function sealCandidate(options: SealCandidateOptions) {
    const { outputDirectory, targetDirectories } = options
    const expected = checkedExpectation(options)
    const [firstTarget, secondTarget] = targets
    const records = await Promise.all([
        loadTarget(targetDirectories[firstTarget], expected, firstTarget),
        loadTarget(targetDirectories[secondTarget], expected, secondTarget),
    ] as const)
    const { sealed, reportBytes } = assembleCandidate(
        records,
        expected,
        options.publisherName,
    )
    await Promise.all(
        records.map((record) =>
            verifyAssets(
                targetDirectories[record.package.manifest.target],
                record,
            ),
        ),
    )
    const assets = records.flatMap((record) => {
        const directory = targetDirectories[record.package.manifest.target]
        return assetsFor(record).map(({ name, identity, limit }) => ({
            name,
            identity,
            limit,
            source: join(directory, name),
        }))
    })
    const files = [candidateName, reportName, ...assets.map(({ name }) => name)]
    await prepareOutput(outputDirectory, files)
    for (const { name, identity, limit, source } of assets) {
        // oxlint-disable-next-line no-await-in-loop
        await copyAsset(source, join(outputDirectory, name), identity, limit)
    }
    await saveMetadata(outputDirectory, reportName, reportBytes)
    await saveMetadata(outputDirectory, candidateName, jsonBytes(sealed))
    await checkDirectory(outputDirectory, files)
    return sealed
}

export interface CandidateHandoffExpectation {
    source: AppSource
    build: BuildIdentity
    artifact: {
        id: string
        sha256: string
        expiresAt: string
        expired: boolean
    }
    downloadedArtifact: { id: string; sha256: string }
    now: Date
}

/**
 * The protected caller authenticates the GitHub receipt and its association
 * with the admitted successful run, attempt, workflow and source. It computes
 * the downloaded ZIP hash, validates the ZIP's paths, types and limits and
 * safely extracts that exact ZIP into a private, read-only-to-others directory.
 * This check verifies the extracted content without opening the app archive.
 */
export async function verifyCandidateHandoff(
    directory: string,
    expected: CandidateHandoffExpectation,
) {
    const receipt = artifactReceipt.parse(expected.artifact)
    const downloaded = downloadedIdentity.parse(expected.downloadedArtifact)
    const now = expected.now.getTime()
    if (
        !Number.isFinite(now) ||
        receipt.expired ||
        Date.parse(receipt.expiresAt) <= now ||
        receipt.id !== downloaded.id ||
        receipt.sha256 !== downloaded.sha256
    ) {
        throw new Error(
            'Candidate artifact receipt is expired or differs from the download',
        )
    }

    const admitted = checkedExpectation({ ...expected, purpose: 'candidate' })
    await assertDirectory(directory)
    const candidateFile = await readJson(
        join(directory, candidateName),
        metadataLimit,
    )
    const candidate = parseCandidate(candidateFile.value)
    const report = await readJson(
        join(directory, reportName),
        metadataLimit,
        candidate.evidence.report,
    )
    const records = validationReport.parse(report.value).targets
    const { sealed, reportBytes } = assembleCandidate(
        records,
        admitted,
        candidate.release.publisher.name,
    )
    if (
        !candidateFile.bytes.equals(jsonBytes(sealed)) ||
        !report.bytes.equals(reportBytes)
    )
        throw new Error('Candidate handoff differs from its canonical seal')

    await checkDirectory(directory, [
        candidateName,
        reportName,
        ...records.flatMap((record) =>
            Object.values(assetNames(record.package.manifest)),
        ),
    ])
    await Promise.all(records.map((record) => verifyAssets(directory, record)))
    return sealed
}
