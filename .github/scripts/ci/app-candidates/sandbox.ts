import { randomUUID } from 'node:crypto'
import { link, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { buildCandidateBuilder, rustToolchainBin } from './candidate-builder.ts'
import { admittedCargoLock, fetchCrates } from './sandbox-crates.ts'
import { prepareDependencies } from './sandbox-dependencies.ts'
import {
    attach,
    bindReadOnly,
    bunVersion,
    withSandbox,
} from './sandbox-docker.ts'

export { applianceImage } from './sandbox-docker.ts'

/** The Rust limits leave room above app-template-rs: 55 s and about 1.3 GiB with tmpfs on two CPUs. */
export const buildLimits = {
    typescript: {
        memoryMiB: 1536,
        processLimit: 96,
        workMiB: 768,
        timeout: 180_000,
    },
    rust: {
        memoryMiB: 3072,
        processLimit: 256,
        workMiB: 2048,
        timeout: 600_000,
    },
}

interface BuildCommandOptions {
    target: AppManifest['target']
    source: AppManifest['source']
    packageSha256: string
    lockSha256?: string
    nodeModules: boolean
    rust?: { lockSha256: string; crates: boolean }
}

export function buildCommand(options: BuildCommandOptions) {
    const { rust } = options
    return [
        ...(rust
            ? [
                  `PATH=${rustToolchainBin}:/usr/local/bin:/usr/bin:/bin`,
                  'CARGO_HOME=/work/cargo-home',
                  'CARGO_NET_OFFLINE=true',
                  'TMPDIR=/work/tmp',
              ]
            : []),
        'APP_PACKAGE_DIR=/work/package',
        `APP_TARGET=${options.target}`,
        `APP_SOURCE_REPOSITORY_ID=${options.source.repositoryId}`,
        `APP_SOURCE_COMMIT=${options.source.commit}`,
        '/bin/sh',
        '-ceu',
        [
            `test "$(bun --version)" = '${bunVersion}'`,
            'mkdir /work/source /work/package',
            ...(rust ? ['mkdir /work/cargo-home /work/tmp'] : []),
            'cd /work/source',
            // The crate fetch ignored Cargo configuration from the tree, so the build does too.
            '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions' +
                (rust ? ' --exclude=.cargo' : ''),
            'test -f package.json && test ! -L package.json',
            `printf '%s  %s\n' '${options.packageSha256}' package.json | /usr/bin/sha256sum --check --status || exit 65`,
            ...(options.lockSha256
                ? [
                      'test -f bun.lock && test ! -L bun.lock',
                      `printf '%s  %s\n' '${options.lockSha256}' bun.lock | /usr/bin/sha256sum --check --status || exit 65`,
                  ]
                : ['test ! -e bun.lock && test ! -L bun.lock']),
            ...(rust ? admittedCargoLock(rust.lockSha256) : []),
            'rm -rf -- node_modules',
            ...(options.nodeModules
                ? [
                      '/usr/bin/tar -xf /candidate-dependencies.tar --no-same-owner --no-same-permissions',
                  ]
                : []),
            ...(rust?.crates
                ? [
                      '/usr/bin/tar -xf /candidate-crates.tar -C /work --no-same-owner --no-same-permissions',
                  ]
                : []),
            'bun --no-env-file run build >&2',
            'test -d /work/package && test ! -L /work/package',
            "exec /usr/bin/tar --format=ustar --owner=0 --group=0 --mode='u=rwX,go=rX' -C /work/package -cf - .",
        ].join('\n'),
    ]
}

export async function buildInSandbox(options: {
    sourceArchive: string
    archivePath: string
    source: AppManifest['source']
    target: AppManifest['target']
    dependencyDirectory: string
}) {
    const work = await mkdtemp(join(tmpdir(), 'marketplace-candidate-build-'))
    const partial = join(
        dirname(options.archivePath),
        `.candidate-${randomUUID()}.tar`,
    )
    try {
        const deps = await prepareDependencies(
            options.dependencyDirectory,
            work,
            options.target,
        )
        // core/Cargo.lock marks a Rust backend, which builds in the pinned toolchain image.
        const rust = deps.cargoLockSha256
            ? {
                  image: await buildCandidateBuilder(options.target),
                  lockSha256: deps.cargoLockSha256,
              }
            : undefined
        const crates =
            rust && deps.hasCargoDependencies
                ? await fetchCrates({
                      sourceArchive: options.sourceArchive,
                      work,
                      target: options.target,
                      image: rust.image,
                      lockSha256: rust.lockSha256,
                  })
                : undefined
        const limits = rust ? buildLimits.rust : buildLimits.typescript
        await withSandbox(
            {
                target: options.target,
                image: rust?.image,
                memoryMiB: limits.memoryMiB,
                processLimit: limits.processLimit,
                mounts: [
                    ...bindReadOnly(
                        options.sourceArchive,
                        '/candidate-source.tar',
                    ),
                    ...(deps.path
                        ? bindReadOnly(deps.path, '/candidate-dependencies.tar')
                        : []),
                    ...(crates
                        ? bindReadOnly(crates, '/candidate-crates.tar')
                        : []),
                    '--tmpfs',
                    '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
                    '--tmpfs',
                    // Offline build tools load native addons from this volume.
                    `/work:rw,exec,nosuid,nodev,size=${limits.workMiB}m,uid=21001,gid=21004,mode=0700`,
                ],
                command: buildCommand({
                    target: options.target,
                    source: options.source,
                    packageSha256: deps.packageSha256,
                    lockSha256: deps.lockSha256,
                    nodeModules: deps.path !== undefined,
                    rust: rust && {
                        lockSha256: rust.lockSha256,
                        crates: crates !== undefined,
                    },
                }),
            },
            (name) =>
                attach(['start', '--attach', name], {
                    operation: 'Offline candidate build',
                    timeout: limits.timeout,
                    archive: {
                        path: partial,
                        maxBytes: 256 * 1024 * 1024,
                    },
                }),
        )
        await link(partial, options.archivePath)
    } finally {
        await Promise.all([
            rm(partial, { force: true }),
            rm(work, { recursive: true, force: true }),
        ])
    }
}
