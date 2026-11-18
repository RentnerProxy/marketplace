import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AppManifest } from '../../../../contracts/v1/index.ts'

const bomShape = z
    .object({
        bomFormat: z.literal('CycloneDX'),
        specVersion: z.string(),
        version: z.number().int().positive(),
        components: z.array(z.unknown()).optional(),
    })
    .passthrough()

const dependencies = z.object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
})

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
    const config = dependencies.parse(
        JSON.parse(
            await readFile(
                join(options.dependenciesDirectory, 'package.json'),
                'utf8',
            ),
        ) as unknown,
    )
    const hasDependencies = Object.values(config).some(
        (group) => group && Object.keys(group).length > 0,
    )
    await scan('dependency vulnerability and inventory scan', [
        '--format',
        'cyclonedx',
        '--output',
        sbomPath,
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
        options.dependenciesDirectory,
    ])
    const info = await lstat(sbomPath)
    if (!info.isFile() || info.size < 1 || info.size > 16_777_216) {
        throw new Error('Candidate SBOM violates its size limit')
    }
    const bom = bomShape.parse(
        JSON.parse(await readFile(sbomPath, 'utf8')) as unknown,
    )
    if (hasDependencies && !bom.components?.length)
        throw new Error('Candidate dependency inventory is empty')
    // Retain inventory data and reviewed license metadata. Secret-scan output
    // is never attached to the candidate or printed to the job log.
    await writeFile(
        sbomPath,
        JSON.stringify({
            ...bom,
            components: bom.components ?? [],
            metadata: {
                component: {
                    type: 'application',
                    name: options.manifest.id,
                    version: options.manifest.version,
                    licenses: [
                        { license: { name: options.manifest.display.license } },
                    ],
                },
            },
        }) + '\n',
    )
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
