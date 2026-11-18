import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import {
    attach,
    bindReadOnly,
    bunVersion,
    withSandbox,
} from './sandbox-docker.ts'

const npmName = '(?:@[a-zA-Z0-9._-]+/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*'
const packageName = z.string().regex(new RegExp(`^${npmName}$`, 'u'))
const range = z
    .string()
    .regex(/^(?:[0-9^~<>=*]|[xX](?:\.|$))[0-9a-zA-Z.*^~<>=+| -]*$/u)
const dependencyMap = z.record(packageName, range)
const packageInput = z.object({
    name: packageName.optional(),
    version: z.string().optional(),
    scripts: z.object({ build: z.string().min(1) }),
    dependencies: dependencyMap.optional(),
    devDependencies: dependencyMap.optional(),
    optionalDependencies: dependencyMap.optional(),
    peerDependencies: dependencyMap.optional(),
    overrides: dependencyMap.optional(),
    workspaces: z.never().optional(),
    patchedDependencies: z.never().optional(),
    resolutions: z.never().optional(),
})
const lockEntry = z.tuple([
    z
        .string()
        .regex(
            new RegExp(
                `^${npmName}@[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$`,
                'u',
            ),
        ),
    z.string(),
    z.object({
        dependencies: dependencyMap.optional(),
        optionalDependencies: dependencyMap.optional(),
        peerDependencies: dependencyMap.optional(),
        optionalPeers: z.array(packageName).optional(),
        bin: z
            .union([z.string(), z.record(packageName, z.string())])
            .optional(),
        os: z.union([z.string(), z.array(z.string())]).optional(),
        cpu: z.union([z.string(), z.array(z.string())]).optional(),
        libc: z.union([z.string(), z.array(z.string())]).optional(),
        bundled: z.boolean().optional(),
    }),
    z.string().regex(/^sha(?:1|256|384|512)-[a-zA-Z0-9+/]+=*$/u),
])
const textLock = z.object({
    lockfileVersion: z.union([z.literal(2), z.literal(3)]),
    configVersion: z.literal(1).optional(),
    workspaces: z
        .object({
            '': z.object({
                name: packageName.optional(),
                version: z.string().optional(),
                dependencies: dependencyMap.optional(),
                devDependencies: dependencyMap.optional(),
                optionalDependencies: dependencyMap.optional(),
                peerDependencies: dependencyMap.optional(),
            }),
        })
        .strict(),
    packages: z.record(z.string(), lockEntry),
    overrides: dependencyMap.optional(),
    patchedDependencies: z.never().optional(),
    catalogs: z.never().optional(),
})

interface Dependencies {
    packageSha256: string
    lockSha256?: string
    path?: string
}

async function readInput(path: string, maxBytes: number, optional = false) {
    const stats = await lstat(path).catch((error: unknown) => {
        if (
            optional &&
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            return undefined
        throw error
    })
    if (!stats) return undefined
    if (!stats.isFile() || stats.size > maxBytes)
        throw new Error('Invalid staged candidate dependency input')
    const bytes = await readFile(path)
    if (bytes.byteLength > maxBytes)
        throw new Error(
            'Staged candidate dependency input exceeds its byte limit',
        )
    return bytes
}

function sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex')
}

export async function prepareDependencies(
    input: string,
    work: string,
    target: AppManifest['target'],
): Promise<Dependencies> {
    const [packageBytes, lockBytes] = await Promise.all([
        readInput(join(input, 'package.json'), 1024 * 1024),
        readInput(join(input, 'bun.lock'), 8 * 1024 * 1024, true),
    ])
    if (!packageBytes) throw new Error('Missing staged candidate package.json')
    const identities = {
        packageSha256: sha256(packageBytes),
        lockSha256: lockBytes && sha256(lockBytes),
    }
    const decoded: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(packageBytes),
    )
    const { scripts: _scripts, ...manifest } = packageInput.parse(decoded)
    const {
        dependencies,
        devDependencies,
        optionalDependencies,
        peerDependencies,
    } = manifest
    if (
        ![
            dependencies,
            devDependencies,
            optionalDependencies,
            peerDependencies,
        ].some((group) => group && Object.keys(group).length)
    )
        return identities

    // Let Bun read only a standalone, script-free manifest and a frozen npm registry lock.
    if (!lockBytes)
        throw new Error('Candidate dependencies require a frozen bun.lock')
    const lockSource = new TextDecoder('utf-8', { fatal: true }).decode(
        lockBytes,
    )
    const lock = textLock.parse(Bun.JSONC.parse(lockSource))
    for (const [specifier, registry] of Object.values(lock.packages)) {
        const versionSeparator = specifier.lastIndexOf('@')
        const name = specifier.slice(0, versionSeparator)
        const version = specifier.slice(versionSeparator + 1)
        const base = name.slice(name.lastIndexOf('/') + 1)
        if (
            registry !== '' &&
            registry !==
                `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`
        ) {
            throw new Error(
                'Candidate dependency locks must resolve packages through the public npm registry',
            )
        }
    }

    const staged = join(work, 'dependencies')
    await mkdir(staged)
    await Promise.all([
        writeFile(join(staged, 'package.json'), JSON.stringify(manifest), {
            mode: 0o644,
        }),
        writeFile(join(staged, 'bun.lock'), JSON.stringify(lock), {
            mode: 0o644,
        }),
    ])
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
                    'bun --no-env-file install --frozen-lockfile --ignore-scripts --no-cache --registry https://registry.npmjs.org >&2',
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
