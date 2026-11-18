import { afterEach, expect, test } from 'bun:test'
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    unlink,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    sealCandidate,
    sealTarget,
    verifyCandidateHandoff,
    type CandidateHandoffExpectation,
    type Purpose,
} from '../../../../../.github/scripts/ci/app-candidates/evidence.ts'
import { candidateSbom } from '../../../../../.github/scripts/ci/app-candidates/scan.ts'
import fixtures from '../../../../../contracts/v1/fixtures.json'
import { parseAppManifest } from '../../../../../contracts/v1/index.ts'
import {
    candidateBuild as build,
    candidateEvidenceFixture,
    candidateTargets as targets,
} from './app-candidate-evidence.fixture.ts'

const source = fixtures.manifest.source
const checks = {
    package: 'passed',
    securityScan: 'passed',
    applianceSmoke: 'passed',
}
const directories: string[] = []

test('keeps the CycloneDX root reference linked to its dependency graph', () => {
    const graph = [{ ref: 'trivy-root', dependsOn: ['locked-child'] }]
    const original = {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        version: 1,
        metadata: {
            component: {
                type: 'application',
                name: '/tmp/fixture',
                'bom-ref': 'trivy-root',
            },
        },
        components: [
            {
                type: 'library',
                name: 'locked-child',
                'bom-ref': 'locked-child',
            },
        ],
        dependencies: graph,
    }
    const result = candidateSbom(
        original,
        parseAppManifest(fixtures.manifest),
        true,
    )
    expect(result.metadata.component).toMatchObject({
        'bom-ref': 'trivy-root',
        name: fixtures.manifest.id,
        version: fixtures.manifest.version,
    })
    expect(result.dependencies).toEqual(graph)
    expect(() =>
        candidateSbom(
            { ...original, components: [] },
            parseAppManifest(fixtures.manifest),
            true,
        ),
    ).toThrow()
})

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((path) => rm(path, { recursive: true, force: true })),
    )
})

function handoffExpectation(): CandidateHandoffExpectation {
    const identity = { id: '89765', sha256: 'a'.repeat(64) }
    return {
        source,
        build,
        artifact: {
            ...identity,
            expiresAt: '2026-11-20T00:00:00.000Z',
            expired: false,
        },
        downloadedArtifact: identity,
        now: new Date('2026-11-19T00:00:00.000Z'),
    }
}

async function scenario(purpose: Purpose = 'candidate') {
    const directory = await mkdtemp(join(tmpdir(), 'app-candidate-evidence-'))
    directories.push(directory)
    return candidateEvidenceFixture(directory, purpose)
}
test('seals a deterministic dual-target handoff and preserves all original byte identities', async () => {
    const fixture = await scenario()
    const { options, outputDirectory, archives, sbom } = fixture
    const first = await sealCandidate(options)
    const before = (await readdir(outputDirectory)).toSorted()
    expect(before).toHaveLength(8)
    expect(
        await verifyCandidateHandoff(outputDirectory, handoffExpectation()),
    ).toEqual(first)
    await Promise.all(
        [...archives].map(async ([name, bytes]) => {
            expect(await readFile(join(outputDirectory, name), 'utf8')).toBe(
                bytes,
            )
            expect(
                await readFile(
                    join(outputDirectory, name + '.sbom.json'),
                    'utf8',
                ),
            ).toBe(sbom)
        }),
    )
    expect(
        await Promise.all(fixture.targetOptions.map(sealTarget)),
    ).toHaveLength(2)
    const again = await sealCandidate(options)
    expect(again).toEqual(first)
    expect((await readdir(outputDirectory)).toSorted()).toEqual(before)
    expect(
        again.release.packages.map(({ manifest }) => manifest.target),
    ).toEqual([...targets])
})

test('requires both targets, the admitted source and exact workflow run and attempt', async () => {
    const { options, targetDirectories } = await scenario()
    await expect(
        sealCandidate({
            ...options,
            source: { ...source, repositoryId: '999' },
        }),
    ).rejects.toThrow('mismatch')
    await expect(
        sealCandidate({
            ...options,
            build: { ...build, workflowCommit: '9'.repeat(40) },
        }),
    ).rejects.toThrow('mismatch')
    await expect(
        sealCandidate({
            ...options,
            build: { ...build, workflowPath: '.github/workflows/other.yml' },
        }),
    ).rejects.toThrow('mismatch')
    await expect(
        sealCandidate({ ...options, build: { ...build, runId: '999' } }),
    ).rejects.toThrow('mismatch')
    await expect(
        sealCandidate({ ...options, build: { ...build, attempt: 2 } }),
    ).rejects.toThrow('mismatch')
    await expect(
        sealCandidate({
            ...options,
            targetDirectories: {
                'linux-amd64': targetDirectories['linux-arm64'],
                'linux-arm64': targetDirectories['linux-amd64'],
            },
        }),
    ).rejects.toThrow('mismatch')
    await unlink(join(targetDirectories['linux-arm64'], 'target.json'))
    await expect(sealCandidate(options)).rejects.toThrow()
})

test('rejects failing, tampered and malformed target evidence', async () => {
    const { options, targetDirectories, targetOptions } = await scenario()
    const path = join(targetDirectories['linux-arm64'], 'target.json')
    const original = await readFile(path, 'utf8')
    const record: unknown = JSON.parse(
        original.replace(
            '"securityScan": "passed"',
            '"securityScan": "failed"',
        ),
    )
    expect(record).toHaveProperty('checks.securityScan', 'failed')
    await writeFile(path, JSON.stringify(record))
    await expect(sealCandidate(options)).rejects.toThrow()
    await writeFile(path, original)
    const originalSbom = targetOptions[0].sbomPath
    await writeFile(originalSbom, JSON.stringify({ bomFormat: 'SPDX' }))
    await expect(sealTarget(targetOptions[0])).rejects.toThrow()
    const targetFiles = await readdir(targetDirectories['linux-arm64'])
    const provenance = targetFiles.find((name) =>
        name.endsWith('.provenance.json'),
    )
    expect(provenance).toBeDefined()
    await writeFile(
        join(targetDirectories['linux-arm64'], provenance ?? ''),
        JSON.stringify({ checks }),
    )
    await expect(sealCandidate(options)).rejects.toThrow(
        'digest or length mismatch',
    )
})

test('rejects extra, missing, modified and independently re-sealed assets at handoff', async () => {
    const { options, outputDirectory, archives } = await scenario()
    const sealed = await sealCandidate(options)
    const expected = handoffExpectation()
    const [name, bytes] = [...archives][0]
    const archive = join(outputDirectory, name)
    await writeFile(archive, 'x' + bytes.slice(1))
    await expect(
        verifyCandidateHandoff(outputDirectory, expected),
    ).rejects.toThrow('digest or length mismatch')
    await expect(sealCandidate(options)).rejects.toThrow(
        'digest or length mismatch',
    )
    expect(await readFile(archive, 'utf8')).toBe('x' + bytes.slice(1))
    await writeFile(archive, bytes)
    const unwanted = join(outputDirectory, '.extra')
    await writeFile(unwanted, 'unexpected')
    await expect(
        verifyCandidateHandoff(outputDirectory, expected),
    ).rejects.toThrow('Unexpected entry')
    await unlink(unwanted)
    const sbom = archive + '.sbom.json'
    const originalSbom = await readFile(sbom)
    await unlink(sbom)
    await expect(
        verifyCandidateHandoff(outputDirectory, expected),
    ).rejects.toThrow('Missing files')
    await writeFile(sbom, originalSbom)
    const report = join(outputDirectory, 'validation-report.json')
    const originalReport = await readFile(report, 'utf8')
    await writeFile(
        report,
        originalReport.replace('"result": "passed"', '"result": "failed"'),
    )
    await expect(
        verifyCandidateHandoff(outputDirectory, expected),
    ).rejects.toThrow('digest or length mismatch')
    await writeFile(report, originalReport)
    await writeFile(
        join(outputDirectory, 'candidate.json'),
        JSON.stringify({ ...sealed, revision: 2 }, null, 2) + '\n',
    )
    await expect(
        verifyCandidateHandoff(outputDirectory, expected),
    ).rejects.toThrow('canonical seal')
})

test('requires current authenticated artifact metadata and candidate purpose', async () => {
    const { options, outputDirectory } = await scenario()
    await sealCandidate(options)
    const expected = handoffExpectation()
    await expect(
        verifyCandidateHandoff(outputDirectory, {
            ...expected,
            artifact: { ...expected.artifact, expired: true },
        }),
    ).rejects.toThrow('expired')
    await expect(
        verifyCandidateHandoff(outputDirectory, {
            ...expected,
            now: new Date(expected.artifact.expiresAt),
        }),
    ).rejects.toThrow('expired')
    await expect(
        verifyCandidateHandoff(outputDirectory, {
            ...expected,
            downloadedArtifact: {
                ...expected.downloadedArtifact,
                sha256: 'c'.repeat(64),
            },
        }),
    ).rejects.toThrow('download')
    await expect(
        verifyCandidateHandoff(outputDirectory, {
            ...expected,
            downloadedArtifact: { ...expected.downloadedArtifact, id: '9' },
        }),
    ).rejects.toThrow('download')
    await expect(
        verifyCandidateHandoff(outputDirectory, {
            ...expected,
            build: { ...build, attempt: 2 },
        }),
    ).rejects.toThrow('mismatch')
    const reference = await scenario('reference')
    await sealCandidate(reference.options)
    await expect(
        verifyCandidateHandoff(reference.outputDirectory, expected),
    ).rejects.toThrow('mismatch')
})
