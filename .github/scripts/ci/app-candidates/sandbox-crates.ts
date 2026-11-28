import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { rustHosts, rustToolchainBin } from './candidate-builder.ts'
import { attach, bindReadOnly, withSandbox } from './sandbox-docker.ts'
import { cargoLockPath } from './source.ts'

export const crateFetchLimits = {
    memoryMiB: 1024,
    processLimit: 64,
    workMiB: 1024,
    timeout: 180_000,
    archiveBytes: 512 * 1024 * 1024,
}

/** Shell lines that check the submitted tree's lock against the admitted hash. */
export function admittedCargoLock(sha256: string) {
    return [
        'test -d core && test ! -L core',
        `test -f ${cargoLockPath} && test ! -L ${cargoLockPath}`,
        `printf '%s  %s\\n' '${sha256}' ${cargoLockPath} | /usr/bin/sha256sum --check --status || exit 65`,
    ]
}

/**
 * Cargo resolves only the admitted lock's sources and runs no build scripts while fetching.
 * Cargo configuration from the tree is left out, and rustup is not on the path.
 */
export function crateFetchCommand(
    target: AppManifest['target'],
    lockSha256: string,
) {
    return [
        `PATH=${rustToolchainBin}:/usr/local/bin:/usr/bin:/bin`,
        'CARGO_HOME=/work/cargo-home',
        '/bin/sh',
        '-ceu',
        [
            'mkdir /work/source /work/cargo-home',
            'cd /work/source',
            '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions --exclude=.cargo',
            ...admittedCargoLock(lockSha256),
            'cd core',
            // A workspace root above core/ would make Cargo resolve a lock that was not admitted.
            'test "$(cargo locate-project --workspace --message-format plain)" = /work/source/core/Cargo.toml || exit 65',
            `cargo fetch --locked --target ${rustHosts[target]} >&2`,
            'cd /work',
            // Offline builds extract crates and check out Git sources themselves.
            'exec /usr/bin/tar --exclude=cargo-home/registry/src --exclude=cargo-home/git/checkouts -cf - cargo-home',
        ].join('\n'),
    ]
}

export async function fetchCrates(options: {
    sourceArchive: string
    work: string
    target: AppManifest['target']
    image: string
    lockSha256: string
}) {
    const path = join(options.work, 'cargo-home.tar')
    await withSandbox(
        {
            target: options.target,
            image: options.image,
            network: 'bridge',
            memoryMiB: crateFetchLimits.memoryMiB,
            processLimit: crateFetchLimits.processLimit,
            mounts: [
                ...bindReadOnly(options.sourceArchive, '/candidate-source.tar'),
                '--tmpfs',
                '/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777',
                '--tmpfs',
                `/work:rw,nosuid,nodev,noexec,size=${crateFetchLimits.workMiB}m,uid=21001,gid=21004,mode=0700`,
            ],
            command: crateFetchCommand(options.target, options.lockSha256),
        },
        (name) =>
            attach(['start', '--attach', name], {
                operation: 'Locked candidate crate fetch',
                timeout: crateFetchLimits.timeout,
                archive: { path, maxBytes: crateFetchLimits.archiveBytes },
            }),
    )
    await chmod(path, 0o444)
    return path
}
