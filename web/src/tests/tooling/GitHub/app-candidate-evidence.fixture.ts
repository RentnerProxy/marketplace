import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    sealTarget,
    type BuildIdentity,
    type Purpose,
} from '../../../../../.github/scripts/ci/app-candidates/evidence.ts'
import fixtures from '../../../../../contracts/v1/fixtures.json'
import { parseAppManifest } from '../../../../../contracts/v1/index.ts'

export const candidateBuild: BuildIdentity = {
    repositoryId: '1234',
    workflowCommit: '4'.repeat(40),
    workflowPath: '.github/workflows/app-candidate.yml',
    runId: '5678',
    attempt: 1,
}
export const candidateTargets = ['linux-amd64', 'linux-arm64'] as const

export async function candidateEvidenceFixture(
    directory: string,
    purpose: Purpose = 'candidate',
    build = candidateBuild,
) {
    const sbomPath = join(directory, 'original-sbom.json')
    const sbom = JSON.stringify({
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        version: 1,
        components: [{ type: 'application', name: 'monitoring' }],
    })
    await writeFile(sbomPath, sbom)
    const targetDirectories = {
        'linux-amd64': join(directory, 'amd64'),
        'linux-arm64': join(directory, 'arm64'),
    }
    const outputDirectory = join(directory, 'candidate')
    const archives = new Map<string, string>()
    const targetOptions = candidateTargets.map((target) => ({
        archivePath: join(directory, `${target}-original.tar.zst`),
        sbomPath,
        manifest: parseAppManifest({ ...fixtures.manifest, target }),
        manifestSha256: createHash('sha256')
            .update(`manifest-${target}`)
            .digest('hex'),
        outputDirectory: targetDirectories[target],
        build,
        purpose,
        applianceImage: `ghcr.io/rentnerproxy/marketplace@sha256:${'5'.repeat(64)}`,
    }))
    await Promise.all(
        targetOptions.map(async (options) => {
            const { id, version, target } = options.manifest
            const name = `${id}-${version}-${target}.tar.zst`
            // The verifier must treat even non-decodable archive bytes as opaque.
            const bytes = `tested archive bytes for ${target}`
            archives.set(name, bytes)
            await writeFile(options.archivePath, bytes)
            await sealTarget(options)
        }),
    )
    const options = {
        outputDirectory,
        targetDirectories,
        source: fixtures.manifest.source,
        build,
        purpose,
        publisherName: 'RentnerProxy',
    }
    return {
        options,
        outputDirectory,
        targetDirectories,
        archives,
        sbom,
        targetOptions,
    }
}
