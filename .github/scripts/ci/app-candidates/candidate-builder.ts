import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'

const repository = resolve(import.meta.dir, '../../../..')
export const builderStage = 'candidate-builder'
/** The builder's toolchain, called without rustup, so a candidate cannot select another one. */
export const rustToolchainBin = '/opt/candidate-rust/bin'
export const rustHosts = {
    'linux-amd64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
} as const satisfies Record<AppManifest['target'], string>
const platforms = {
    'linux-amd64': 'linux/amd64',
    'linux-arm64': 'linux/arm64',
} as const satisfies Record<AppManifest['target'], string>

/**
 * Build the Rust candidate builder from the trusted checkout's digest-pinned Dockerfile stage and
 * return its local content-addressed image ID. Candidate bytes never reach this build.
 */
export async function buildCandidateBuilder(target: AppManifest['target']) {
    const work = await mkdtemp(join(tmpdir(), 'marketplace-candidate-builder-'))
    try {
        const imageIdFile = join(work, 'image-id')
        const child = Bun.spawn(
            [
                'docker',
                'build',
                '--quiet',
                '--platform',
                platforms[target],
                '--target',
                builderStage,
                '--iidfile',
                imageIdFile,
                '--file',
                join(repository, 'Dockerfile'),
                repository,
            ],
            {
                cwd: repository,
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    SystemRoot: process.env.SystemRoot,
                    DOCKER_HOST: process.env.DOCKER_HOST,
                    DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
                    DOCKER_CONFIG: process.env.DOCKER_CONFIG,
                },
                stdin: 'ignore',
                stdout: 'ignore',
                // Only the trusted Dockerfile and its pinned images produce this output.
                stderr: 'inherit',
                signal: AbortSignal.timeout(600_000),
                windowsHide: true,
            },
        )
        if ((await child.exited) !== 0)
            throw new Error('Could not build the pinned Rust candidate builder')
        const image = (await readFile(imageIdFile, 'utf8')).trim()
        if (!/^sha256:[0-9a-f]{64}$/u.test(image))
            throw new Error(
                'Docker reported an invalid candidate builder image',
            )
        return image
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}
