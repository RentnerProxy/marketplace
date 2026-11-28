import { randomUUID } from 'node:crypto'
import { link, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { prepareDependencies } from './sandbox-dependencies.ts'
import {
    attach,
    bindReadOnly,
    bunVersion,
    withSandbox,
} from './sandbox-docker.ts'

export { applianceImage } from './sandbox-docker.ts'

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
        await withSandbox(
            {
                target: options.target,
                memoryMiB: 1536,
                processLimit: 96,
                mounts: [
                    ...bindReadOnly(
                        options.sourceArchive,
                        '/candidate-source.tar',
                    ),
                    ...(deps.path
                        ? bindReadOnly(deps.path, '/candidate-dependencies.tar')
                        : []),
                    '--tmpfs',
                    '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
                    '--tmpfs',
                    // Offline build tools load native addons from this volume.
                    '/work:rw,exec,nosuid,nodev,size=768m,uid=21001,gid=21004,mode=0700',
                ],
                command: [
                    'APP_PACKAGE_DIR=/work/package',
                    `APP_TARGET=${options.target}`,
                    `APP_SOURCE_REPOSITORY_ID=${options.source.repositoryId}`,
                    `APP_SOURCE_COMMIT=${options.source.commit}`,
                    '/bin/sh',
                    '-ceu',
                    [
                        `test "$(bun --version)" = '${bunVersion}'`,
                        'mkdir /work/source /work/package',
                        'cd /work/source',
                        '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions',
                        'test -f package.json && test ! -L package.json',
                        `printf '%s  %s\n' '${deps.packageSha256}' package.json | /usr/bin/sha256sum --check --status || exit 65`,
                        ...(deps.lockSha256
                            ? [
                                  'test -f bun.lock && test ! -L bun.lock',
                                  `printf '%s  %s\n' '${deps.lockSha256}' bun.lock | /usr/bin/sha256sum --check --status || exit 65`,
                              ]
                            : ['test ! -e bun.lock && test ! -L bun.lock']),
                        'rm -rf -- node_modules',
                        ...(deps.path
                            ? [
                                  '/usr/bin/tar -xf /candidate-dependencies.tar --no-same-owner --no-same-permissions',
                              ]
                            : []),
                        'bun --no-env-file run build >&2',
                        'test -d /work/package && test ! -L /work/package',
                        "exec /usr/bin/tar --format=ustar --owner=0 --group=0 --mode='u=rwX,go=rX' -C /work/package -cf - .",
                    ].join('\n'),
                ],
            },
            (name) =>
                attach(['start', '--attach', name], {
                    operation: 'Offline candidate build',
                    timeout: 180_000,
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
