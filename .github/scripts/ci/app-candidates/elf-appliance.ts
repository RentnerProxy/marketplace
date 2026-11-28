import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { runAppPipeline } from '../../native-tools.ts'
import { attach, docker, withSandbox } from './sandbox-docker.ts'

const profiles = {
    'linux-amd64': {
        interpreter: '/lib64/ld-linux-x86-64.so.2',
        libraries: '/lib/x86_64-linux-gnu',
    },
    'linux-arm64': {
        interpreter: '/lib/ld-linux-aarch64.so.1',
        libraries: '/lib/aarch64-linux-gnu',
    },
} as const

export interface ElfLinkage {
    needed: readonly string[]
    interpreter?: (typeof profiles)[AppManifest['target']]['interpreter']
    versions: Readonly<Record<string, readonly string[]>>
}

export async function applianceLibraryVersions(
    target: AppManifest['target'],
    executables: Iterable<ElfLinkage>,
): Promise<Record<string, readonly string[]>> {
    const profile = profiles[target]
    const loader = posix.basename(profile.interpreter)
    const paths = new Map<string, string>()
    for (const { interpreter, needed } of executables) {
        if (interpreter) paths.set(loader, profile.interpreter)
        for (const library of needed) {
            paths.set(
                library,
                library === loader
                    ? profile.interpreter
                    : posix.join(profile.libraries, library),
            )
        }
    }
    if (paths.size === 0) return {}

    const work = await mkdtemp(join(tmpdir(), 'marketplace-elf-appliance-'))
    try {
        return await withSandbox(
            {
                target,
                memoryMiB: 128,
                processLimit: 32,
                mounts: [],
                command: ['/usr/bin/sleep', 'infinity'],
            },
            async (name) => {
                await docker(['start', name])
                // Copy trusted image files without mounting candidate bytes.
                const results = await Promise.allSettled(
                    [...paths].map(async ([library, source]) => {
                        const inputPath = join(work, library)
                        await attach(
                            ['exec', name, '/usr/bin/cat', '--', source],
                            {
                                operation: 'Read pinned appliance library',
                                timeout: 10_000,
                                archive: {
                                    path: inputPath,
                                    maxBytes: 16 * 1024 * 1024,
                                },
                            },
                        )
                        const versions = await runAppPipeline<
                            readonly string[]
                        >('inspect-appliance-library', { inputPath, library })
                        return [library, versions] as const
                    }),
                )
                return Object.fromEntries(
                    results.map((result) => {
                        if (result.status === 'rejected') {
                            throw new Error(
                                'Could not verify a required library in the pinned appliance',
                            )
                        }
                        return result.value
                    }),
                )
            },
        )
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}
