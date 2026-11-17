import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
    assertPicomatchSha256,
    patchedPicomatchVersion,
    picomatchParserSha256,
} from './picomatch-patch.ts'

const patchedPackage = 'picomatch@' + patchedPicomatchVersion
const advisory = 'GHSA-fc5q-39xc-vjpf'
const patchPath = 'patches/picomatch@4.0.7.patch'
const patchSha256 =
    '550d716012d83ec38cb7c7001e2421a7bcbd4b4a61c34f12a0e936945808d15d'

const patchDeclarations = z.object({
    patchedDependencies: z.record(z.string(), z.string()).optional(),
})
const lockSchema = patchDeclarations.extend({
    packages: z.record(z.string(), z.tuple([z.string()]).rest(z.unknown())),
})

export async function bunAuditArguments(root: URL) {
    const args = ['--no-env-file', 'audit', '--audit-level=moderate']
    const lock = lockSchema.parse(
        Bun.JSONC.parse(await readFile(new URL('bun.lock', root), 'utf8')),
    )
    const picomatch = Object.values(lock.packages)
        .map(([resolution]) => resolution)
        .filter((resolution) => resolution.startsWith('picomatch@'))

    // Use the default audit when the patched version leaves the lockfile.
    if (!picomatch.includes(patchedPackage)) return args

    const manifest = patchDeclarations.parse(
        JSON.parse(await readFile(new URL('package.json', root), 'utf8')),
    )
    if (
        picomatch.some((resolution) => resolution !== patchedPackage) ||
        lock.patchedDependencies?.[patchedPackage] !== patchPath ||
        manifest.patchedDependencies?.[patchedPackage] !== patchPath
    ) {
        throw new Error(
            'The picomatch advisory requires the exact patch for every locked copy.',
        )
    }

    await assertPicomatchSha256(new URL(patchPath, root), patchSha256)
    const store = new URL('node_modules/.bun/', root)
    const copies = (await readdir(store)).filter((name) =>
        name.startsWith('picomatch@'),
    )
    if (copies.length === 0) {
        throw new Error('No installed picomatch parser found in the Bun store.')
    }
    await Promise.all(
        copies.map((name) =>
            assertPicomatchSha256(
                new URL(
                    encodeURIComponent(name) +
                        '/node_modules/picomatch/lib/parse.js',
                    store,
                ),
                picomatchParserSha256,
            ),
        ),
    )

    // The registry audit uses the original npm version. Its single exception
    // is available only after proving that the installed parser rejects repeats.
    args.push('--ignore=' + advisory)
    return args
}

if (import.meta.main) {
    const root = new URL('../../../', import.meta.url)
    const args = await bunAuditArguments(root)
    if (args.includes('--ignore=' + advisory)) {
        console.log('Verified the local picomatch patch for ' + advisory + '.')
    }
    const audit = Bun.spawn([process.execPath, ...args], {
        cwd: fileURLToPath(root),
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
        windowsHide: true,
    })
    process.exitCode = await audit.exited
}
