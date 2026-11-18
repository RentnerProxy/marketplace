import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import { readelf, targets, type ElfLinkage } from './elf.ts'
import { attach, docker, withSandbox } from './sandbox-docker.ts'

export function libraryDefinitions(report: string, library: string) {
    const soname = report.match(
        /\(SONAME\)\s+Library soname: \[([^\]\r\n]+)\]/u,
    )?.[1]
    const lines = report.split(/\r?\n/u)
    const definition = lines.findIndex((line) =>
        line.startsWith('Version definition section '),
    )
    const names = new Set<string>()
    let count = 0
    if (definition !== -1) {
        count = Number(
            lines[definition].match(/ contains (\d+) entr(?:y|ies):$/u)?.[1],
        )
        for (const line of lines.slice(definition + 1)) {
            if (line.startsWith('Version ')) break
            const name = line.match(
                /^\s*(?:0x)?[0-9a-f]+:\s+Rev:\s+\d+.*?\bName:\s+([A-Za-z0-9_.+-]+)\s*$/u,
            )?.[1]
            if (name) names.add(name)
        }
    }
    if (soname !== library || names.size !== count) {
        throw new Error(
            'Could not read the pinned appliance library version definitions',
        )
    }
    names.delete(library)
    return names
}

export function verifyApplianceLinkage(
    linkage: ElfLinkage,
    available: ReadonlyMap<string, ReadonlySet<string>>,
) {
    const interpreter =
        linkage.interpreter && posix.basename(linkage.interpreter)
    if (interpreter && !available.has(interpreter))
        throw new Error('ELF interpreter is missing from the pinned appliance')
    for (const library of linkage.needed) {
        const definitions = available.get(library)
        if (!definitions)
            throw new Error(
                'Required ELF library is missing from the pinned appliance',
            )
        for (const version of linkage.versions.get(library) ?? []) {
            if (
                /(?:^|_)PRIVATE(?:_|$)/u.test(version) ||
                !definitions.has(version)
            ) {
                throw new Error(
                    'Required ELF symbol version is unavailable in the pinned appliance',
                )
            }
        }
    }
}

export async function applianceLibraryVersions(
    target: AppManifest['target'],
    executables: Iterable<ElfLinkage>,
) {
    const profile = targets[target]
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
    if (!paths.size) return new Map<string, Set<string>>()

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
                // Copy only approved paths from the trusted pinned image. No candidate bytes
                // are mounted or executed while collecting the appliance ABI evidence.
                const results = await Promise.allSettled(
                    [...paths].map(async ([library, source]) => {
                        const path = join(work, library)
                        await attach(
                            ['exec', name, '/usr/bin/cat', '--', source],
                            {
                                operation: 'Read pinned appliance library',
                                timeout: 10_000,
                                archive: { path, maxBytes: 16 * 1024 * 1024 },
                            },
                        )
                        return [
                            library,
                            libraryDefinitions(await readelf(path), library),
                        ] as const
                    }),
                )
                return new Map(
                    results.map((result) => {
                        if (result.status === 'rejected')
                            throw new Error(
                                'Could not verify a required library in the pinned appliance',
                            )
                        return result.value
                    }),
                )
            },
        )
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}
