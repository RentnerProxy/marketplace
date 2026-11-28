import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
    builderStage,
    rustHosts,
    rustToolchainBin,
} from '../../../../../.github/scripts/ci/app-candidates/candidate-builder.ts'
import {
    crateFetchCommand,
    crateFetchLimits,
} from '../../../../../.github/scripts/ci/app-candidates/sandbox-crates.ts'
import {
    applianceImage,
    sandboxConfig,
} from '../../../../../.github/scripts/ci/app-candidates/sandbox-docker.ts'
import {
    buildCommand,
    buildLimits,
} from '../../../../../.github/scripts/ci/app-candidates/sandbox.ts'

const repository = join(import.meta.dir, '../../../../..')
const source = { repositoryId: '1001', commit: 'a'.repeat(40) }
const packageSha256 = 'b'.repeat(64)
const lockSha256 = 'c'.repeat(64)
const cargoLockSha256 = 'd'.repeat(64)

function script(command: string[]) {
    expect(command.slice(-3, -1)).toEqual(['/bin/sh', '-ceu'])
    return command.at(-1)?.split('\n') ?? []
}

async function dockerStages() {
    const dockerfile = await readFile(join(repository, 'Dockerfile'), 'utf8')
    const stages = new Map<string, { from: string; body: string }>()
    for (const block of dockerfile.split(/^(?=FROM )/mu).slice(1)) {
        const match = /^FROM (\S+) AS (\S+)\n/u.exec(block)
        if (match)
            stages.set(match[2], {
                from: match[1],
                body: block.slice(match[0].length),
            })
    }
    return stages
}

describe('candidate builds', () => {
    test('keeps the TypeScript build in the appliance image unchanged', () => {
        const command = buildCommand({
            target: 'linux-arm64',
            source,
            packageSha256,
            lockSha256,
            nodeModules: true,
        })
        expect(command.slice(0, 4)).toEqual([
            'APP_PACKAGE_DIR=/work/package',
            'APP_TARGET=linux-arm64',
            'APP_SOURCE_REPOSITORY_ID=1001',
            'APP_SOURCE_COMMIT=' + source.commit,
        ])
        expect(script(command)).toEqual([
            `test "$(bun --version)" = '1.4.4'`,
            'mkdir /work/source /work/package',
            'cd /work/source',
            '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions',
            'test -f package.json && test ! -L package.json',
            `printf '%s  %s`,
            `' '${packageSha256}' package.json | /usr/bin/sha256sum --check --status || exit 65`,
            'test -f bun.lock && test ! -L bun.lock',
            `printf '%s  %s`,
            `' '${lockSha256}' bun.lock | /usr/bin/sha256sum --check --status || exit 65`,
            'rm -rf -- node_modules',
            '/usr/bin/tar -xf /candidate-dependencies.tar --no-same-owner --no-same-permissions',
            'bun --no-env-file run build >&2',
            'test -d /work/package && test ! -L /work/package',
            "exec /usr/bin/tar --format=ustar --owner=0 --group=0 --mode='u=rwX,go=rX' -C /work/package -cf - .",
        ])
        expect(sandboxConfig({ ...buildLimits.typescript, target: 'linux-arm64', mounts: [], command }).image).toBe(
            applianceImage,
        )
    })

    test('builds a Rust backend offline with the admitted lock and fetched crates', () => {
        const command = buildCommand({
            target: 'linux-amd64',
            source,
            packageSha256,
            nodeModules: false,
            rust: { lockSha256: cargoLockSha256, crates: true },
        })
        expect(command.slice(0, 4)).toEqual([
            `PATH=${rustToolchainBin}:/usr/local/bin:/usr/bin:/bin`,
            'CARGO_HOME=/work/cargo-home',
            'CARGO_NET_OFFLINE=true',
            'TMPDIR=/work/tmp',
        ])
        const lines = script(command)
        expect(lines).toContain('mkdir /work/cargo-home /work/tmp')
        expect(lines).toContain(
            '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions --exclude=.cargo',
        )
        expect(lines).toContain('test ! -e bun.lock && test ! -L bun.lock')
        expect(lines).toContain(
            `printf '%s  %s\\n' '${cargoLockSha256}' core/Cargo.lock | /usr/bin/sha256sum --check --status || exit 65`,
        )
        const crates = lines.indexOf(
            '/usr/bin/tar -xf /candidate-crates.tar -C /work --no-same-owner --no-same-permissions',
        )
        expect(crates).toBeGreaterThan(lines.indexOf('rm -rf -- node_modules'))
        expect(crates).toBeLessThan(
            lines.indexOf('bun --no-env-file run build >&2'),
        )
        expect(
            script(
                buildCommand({
                    target: 'linux-amd64',
                    source,
                    packageSha256,
                    nodeModules: false,
                    rust: { lockSha256: cargoLockSha256, crates: false },
                }),
            ).some((line) => line.includes('/candidate-crates.tar')),
        ).toBe(false)
        const image = 'sha256:' + 'e'.repeat(64)
        expect(sandboxConfig({ ...buildLimits.rust, image, target: 'linux-amd64', mounts: [], command }).image).toBe(image)
    })

    test.each(Object.entries(rustHosts))(
        'fetches only the locked crates for %s without Cargo configuration from the tree',
        (target, host) => {
            const command = crateFetchCommand(
                target as keyof typeof rustHosts,
                cargoLockSha256,
            )
            expect(command.slice(0, 2)).toEqual([
                `PATH=${rustToolchainBin}:/usr/local/bin:/usr/bin:/bin`,
                'CARGO_HOME=/work/cargo-home',
            ])
            const lines = script(command)
            const lock = lines.indexOf(
                `printf '%s  %s\\n' '${cargoLockSha256}' core/Cargo.lock | /usr/bin/sha256sum --check --status || exit 65`,
            )
            const fetch = lines.indexOf(
                `cargo fetch --locked --target ${host} >&2`,
            )
            expect(lines).toContain(
                '/usr/bin/tar -xf /candidate-source.tar --no-same-owner --no-same-permissions --exclude=.cargo',
            )
            expect(lines).toContain('test -d core && test ! -L core')
            expect(lock).toBeGreaterThan(0)
            expect(fetch).toBeGreaterThan(lock)
            expect(lines.at(-1)).toBe(
                'exec /usr/bin/tar --exclude=cargo-home/registry/src --exclude=cargo-home/git/checkouts -cf - cargo-home',
            )
        },
    )

    test('stays inside the sandbox bounds of the app pipeline', () => {
        for (const limits of Object.values(buildLimits)) {
            expect(limits.memoryMiB).toBeLessThanOrEqual(4096)
            expect(limits.workMiB).toBeLessThan(limits.memoryMiB)
            expect(limits.timeout).toBeLessThanOrEqual(900_000)
            expect(limits.processLimit).toBeLessThanOrEqual(512)
        }
        expect(crateFetchLimits.timeout).toBeLessThanOrEqual(900_000)
        expect(crateFetchLimits.archiveBytes).toBeLessThanOrEqual(
            512 * 1024 * 1024,
        )
    })

    test('pins the Rust builder to Debian 13 and the appliance Bun', async () => {
        const stages = await dockerStages()
        const appliance = stages.get('candidate-appliance')
        const builder = stages.get(builderStage)
        expect(appliance?.from).toBe(applianceImage)
        expect(builder?.from).toMatch(
            /^rust:[0-9.]+-slim-trixie@sha256:[0-9a-f]{64}$/u,
        )
        expect(builder?.body).toContain(
            'COPY --from=candidate-appliance /usr/local/bin/bun /usr/local/bin/bun',
        )
        expect(builder?.body).toContain(
            `ln -s "$(rustc --print sysroot)" ${posix.dirname(rustToolchainBin)}`,
        )
        expect(dirname(rustToolchainBin)).not.toBe('.')
    })
})
