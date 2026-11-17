import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bunAuditArguments } from '../../../../../.github/scripts/security/audit-bun-dependencies.ts'

const repo = new URL('../../../../../', import.meta.url)
const pin = 'picomatch@4.0.7'
const patch = 'patches/picomatch@4.0.7.patch'
const storePath = 'node_modules/.bun/picomatch@4.0.7/node_modules/picomatch'
const defaultArgs = ['--no-env-file', 'audit', '--audit-level=moderate']
const declarations = { patchedDependencies: { [pin]: patch } }

test('a frozen project install permits exactly the verified advisory exception', async () => {
    expect(await bunAuditArguments(repo)).toEqual([
        ...defaultArgs,
        '--ignore=GHSA-fc5q-39xc-vjpf',
    ])
})

test('the installed patch rejects repeats and preserves the globs used for builds', () => {
    const requireFromStore = createRequire(
        new URL('node_modules/.bun/node_modules/dependency-check.js', repo),
    )
    const picomatch = requireFromStore('picomatch') as {
        (pattern: string): (path: string) => boolean
        parse: (pattern: string) => unknown
        makeRe: (pattern: string) => RegExp
    }
    // Harmless literal branches exercise the disabled syntax without executing
    // a generated regular expression for a repeated extglob.
    expect(() => picomatch.parse('+(alpha|beta)')).toThrow(SyntaxError)
    expect(() => picomatch.makeRe('*(alpha|beta).ts')).toThrow(SyntaxError)
    expect(picomatch('web/**/*.{ts,tsx}')('web/src/app.tsx')).toBe(true)
    expect(picomatch('web/**/@(app|index).ts')('web/src/app.ts')).toBe(true)
})

test('an upgraded lockfile uses the full audit without the exception', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-bun-audit-'))
    try {
        const root = pathToFileURL(directory + '/')
        await writeFile(
            new URL('bun.lock', root),
            JSON.stringify({ packages: { picomatch: ['picomatch@4.0.8'] } }),
        )
        expect(await bunAuditArguments(root)).toEqual(defaultArgs)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('the audit rejects an unpatched parser and an additional locked copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-bun-audit-'))
    try {
        const root = pathToFileURL(directory + '/')
        const locked = { ...declarations, packages: { picomatch: [pin] } }
        await Promise.all([
            mkdir(new URL('patches/', root)),
            mkdir(new URL(storePath + '/lib/', root), { recursive: true }),
        ])
        await Promise.all([
            writeFile(
                new URL('package.json', root),
                JSON.stringify(declarations),
            ),
            writeFile(new URL('bun.lock', root), JSON.stringify(locked)),
            writeFile(
                new URL(patch, root),
                await readFile(new URL(patch, repo)),
            ),
            writeFile(
                new URL(storePath + '/lib/parse.js', root),
                'unpatched fixture',
            ),
        ])
        await expect(bunAuditArguments(root)).rejects.toThrow('parser digest')

        const mixed = {
            ...locked,
            packages: {
                ...locked.packages,
                'other/picomatch': ['picomatch@4.0.6'],
            },
        }
        await writeFile(new URL('bun.lock', root), JSON.stringify(mixed))
        await expect(bunAuditArguments(root)).rejects.toThrow(
            'every locked copy',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
