import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { runAppPipeline } from '../../native-tools.ts'
import {
    attach,
    bindReadOnly,
    bunVersion,
    withSandbox,
} from './sandbox-docker.ts'

interface Dependencies {
    packageSha256: string
    lockSha256?: string
    /** Present for a Rust backend: the admitted core/Cargo.lock. */
    cargoLockSha256?: string
    hasCargoDependencies?: boolean
    path?: string
}

export async function prepareDependencies(
    input: string,
    work: string,
    target: AppManifest['target'],
): Promise<Dependencies> {
    const staged = join(work, 'dependencies')
    const { hasDependencies, ...identities } = await runAppPipeline<
        Dependencies & { hasDependencies: boolean }
    >('dependency-admit', {
        directory: input,
        outputDirectory: staged,
    })
    if (!hasDependencies) return identities

    const path = join(work, 'node-modules.tar')
    await withSandbox(
        {
            target,
            network: 'bridge',
            memoryMiB: 1024,
            processLimit: 64,
            mounts: [
                ...bindReadOnly(staged, '/dependency-input'),
                '--tmpfs',
                '/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777',
                '--tmpfs',
                '/work:rw,nosuid,nodev,noexec,size=512m,uid=21001,gid=21004,mode=0700',
            ],
            command: [
                '/bin/sh',
                '-ceu',
                [
                    `test "$(bun --version)" = '${bunVersion}'`,
                    'cd /work',
                    'cp /dependency-input/package.json /dependency-input/bun.lock .',
                    // Bun uses the cache directory for extraction even with --no-cache.
                    'BUN_INSTALL_CACHE_DIR=/work/.bun-install-cache bun --no-env-file install --frozen-lockfile --ignore-scripts --no-cache --registry https://registry.npmjs.org >&2',
                    'exec /usr/bin/tar -cf - node_modules',
                ].join('\n'),
            ],
        },
        (name) =>
            attach(['start', '--attach', name], {
                operation: 'Locked candidate dependency preparation',
                timeout: 120_000,
                archive: { path, maxBytes: 512 * 1024 * 1024 },
            }),
    )
    await chmod(path, 0o444)
    return { ...identities, path }
}
