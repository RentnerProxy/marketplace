import { join } from 'node:path'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import { runAppPipeline, runAppPipelineSync } from '../../native-tools.ts'

type ManifestIdentity = Pick<AppManifest, 'id' | 'version' | 'display'>

interface CandidateSbom {
    [key: string]: unknown
    bomFormat: 'CycloneDX'
    specVersion: string
    version: number
    components: unknown[]
    dependencies?: unknown[]
    metadata: {
        [key: string]: unknown
        component: {
            [key: string]: unknown
            name: string
            version: string
            type: 'application'
            licenses: { license: { name: string } }[]
        }
    }
}

export function candidateSbom(
    input: unknown,
    manifest: ManifestIdentity,
    hasDependencies: boolean,
) {
    return runAppPipelineSync<CandidateSbom>('sbom-normalize', {
        input,
        manifest,
        hasDependencies,
    })
}

const vulnerabilityPolicy = [
    '--scanners',
    'vuln',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '1',
    '--include-dev-deps',
    '--db-repository',
    'public.ecr.aws/aquasecurity/trivy-db:2',
    '--db-repository',
    'mirror.gcr.io/aquasec/trivy-db:2',
    '--db-repository',
    'ghcr.io/aquasecurity/trivy-db:2',
]

export async function scanCandidate(options: {
    trivyBinary: string
    directory: string
    dependenciesDirectory: string
    packageDirectory: string
    manifest: AppManifest
}) {
    const cache = join(options.directory, 'trivy-cache')
    const scan = async (label: string, args: string[]) => {
        const child = Bun.spawn(
            [
                options.trivyBinary,
                '--cache-dir',
                cache,
                'fs',
                '--timeout',
                '3m',
                '--no-progress',
                '--ignorefile',
                '/dev/null',
                ...args,
            ],
            {
                cwd: options.directory,
                env: {
                    PATH: process.env.PATH,
                    HOME: options.directory,
                    LANG: 'C.UTF-8',
                },
                stdin: 'ignore',
                stdout: 'ignore',
                stderr: 'ignore',
                signal: AbortSignal.timeout(200_000),
            },
        )
        if ((await child.exited) !== 0)
            throw new Error('Candidate ' + label + ' failed')
    }
    const sbomPath = join(options.directory, 'sbom.json')
    await scan('dependency vulnerability and inventory scan', [
        '--format',
        'cyclonedx',
        '--output',
        sbomPath,
        ...vulnerabilityPolicy,
        options.dependenciesDirectory,
    ])
    await runAppPipeline('sbom-normalize-file', {
        path: sbomPath,
        manifest: options.manifest,
        dependenciesDirectory: options.dependenciesDirectory,
    })
    await scan('packaged dependency vulnerability scan', [
        ...vulnerabilityPolicy,
        '--skip-db-update',
        options.packageDirectory,
    ])
    await scan('package secret scan', [
        '--format',
        'json',
        '--output',
        join(options.directory, 'secrets-scan.json'),
        '--scanners',
        'secret',
        '--exit-code',
        '1',
        options.packageDirectory,
    ])
    return sbomPath
}
