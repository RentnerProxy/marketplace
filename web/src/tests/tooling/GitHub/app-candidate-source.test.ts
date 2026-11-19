import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stageGitSource } from '../../../../../.github/scripts/ci/app-candidates/source.ts'

type Source = Parameters<typeof stageGitSource>[1]
type Transport = Parameters<typeof stageGitSource>[2]
const repoName = 'example-org/candidate-source'
const repoId = '10001'
const oldManifest =
    '{"name":"example-app","scripts":{"build":"bun ./build.ts"}}\n'
const originalLock =
    '{"lockfileVersion":3,"workspaces":{"":{}},"packages":{}}\n'
const tempPrefix = join(tmpdir(), 'candidate-git-source-')
let scratch: string | undefined
let origin: string
let commit: string

function command(executable: string, args: string[], cwd: string) {
    return execFileSync(executable, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    })
}

function git(cwd: string, ...args: string[]) {
    return command(
        'git',
        [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'commit.gpgsign=false',
            '-c',
            'core.autocrlf=false',
            ...args,
        ],
        cwd,
    )
}

function wanted(path: string): Source {
    return {
        repository: repoName,
        commit,
        path,
        source: { repositoryId: repoId, commit },
    }
}

function objects(directory: string) {
    return new Set(
        git(
            directory,
            'cat-file',
            '--batch-all-objects',
            '--batch-check=%(objectname)',
        )
            .trim()
            .split(/\r?\n/u),
    )
}

function treeInfo(repository: string, tree: string) {
    const entries = git(repository, 'ls-tree', '-r', '-t', '-l', '-z', tree)
        .split('\0')
        .filter(Boolean)
        .map((line) => {
            const match = /^\d+ (blob|tree) ([a-f0-9]{40}) +(\d+|-)\t/.exec(
                line,
            )
            if (!match) throw new Error('Invalid Git fixture tree entry')
            const [, type, sha, size] = match
            return { type, sha, size: size === '-' ? undefined : Number(size) }
        })
    return { sha: tree, truncated: false, tree: entries }
}

function localTransport(overrides: Partial<Transport> = {}): Transport {
    return {
        origin: () => pathToFileURL(origin),
        async resolve(request) {
            return { ...request, source: { repositoryId: repoId, commit } }
        },
        async readTree(repository, tree) {
            expect(repository).toBe(repoName)
            return treeInfo(origin, tree)
        },
        ...overrides,
    }
}

async function destination(name: string) {
    if (!scratch) throw new Error('Missing Git fixture')
    const path = join(scratch, name)
    await mkdir(path)
    return path
}

beforeAll(async () => {
    scratch = await mkdtemp(tempPrefix)
    if (!scratch.startsWith(tempPrefix))
        throw new Error('Unexpected Git fixture directory')
    origin = await destination('origin')
    git(origin, 'init', '--initial-branch=main', '--template=')
    git(origin, 'config', 'uploadpack.allowFilter', 'true')
    git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')

    await Promise.all([
        mkdir(join(origin, 'apps', 'candidate', 'assets'), { recursive: true }),
        mkdir(join(origin, 'missing'), { recursive: true }),
        mkdir(join(origin, 'invalid', 'package.json'), { recursive: true }),
        mkdir(join(origin, 'without-lock'), { recursive: true }),
    ])
    await Promise.all([
        writeFile(
            join(origin, 'apps', 'candidate', 'package.json'),
            oldManifest,
        ),
        writeFile(join(origin, 'apps', 'candidate', 'bun.lock'), originalLock),
        writeFile(
            join(origin, 'apps', 'candidate', 'assets', 'message.txt'),
            'old asset\n',
        ),
        writeFile(
            join(origin, 'outside.txt'),
            'keep this blob outside the staged app\n',
        ),
        writeFile(
            join(origin, 'missing', 'readme.txt'),
            'package.json is absent\n',
        ),
        writeFile(
            join(origin, 'invalid', 'package.json', 'readme.txt'),
            'package.json is a directory\n',
        ),
        writeFile(join(origin, 'without-lock', 'package.json'), oldManifest),
    ])
    git(origin, 'add', '-f', '--', '.')
    git(origin, 'commit', '-m', 'Original fixture')
    commit = git(origin, 'rev-parse', 'HEAD').trim()
    await Promise.all([
        writeFile(
            join(origin, 'apps', 'candidate', 'package.json'),
            '{"name":"updated-app"}\n',
        ),
        writeFile(
            join(origin, 'apps', 'candidate', 'assets', 'message.txt'),
            'updated asset\n',
        ),
    ])
    git(origin, 'add', '--', '.')
    git(origin, 'commit', '-m', 'Advance fixture branch')
}, 15_000)

afterAll(async () => {
    if (scratch?.startsWith(tempPrefix))
        await rm(scratch, { recursive: true, force: true })
})

describe('candidate Git source staging', () => {
    test('preserves an existing archive and removes the temporary copy', async () => {
        const stage = await destination('occupied-archive')
        const archive = join(stage, 'source.tar')
        await writeFile(archive, 'an existing source archive')
        await expect(
            stageGitSource(stage, wanted('apps/candidate'), localTransport()),
        ).rejects.toMatchObject({ code: 'EEXIST' })
        expect(await readFile(archive, 'utf8')).toBe(
            'an existing source archive',
        )
        expect(
            (await readdir(stage)).filter((name) =>
                name.startsWith('.source-archive-'),
            ),
        ).toEqual([])
    }, 15_000)

    test('removes partial output when TAR overhead exceeds the archive limit', async () => {
        const largeOrigin = await destination('archive-limit-origin')
        const stage = await destination('archive-limit-stage')
        git(largeOrigin, 'init', '--initial-branch=main', '--template=')
        git(largeOrigin, 'config', 'uploadpack.allowFilter', 'true')
        git(largeOrigin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
        const chunk = Buffer.alloc(4 * 1024 * 1024, 97)
        await Promise.all(
            Array.from({ length: 16 }, (_, index) =>
                writeFile(
                    join(largeOrigin, 'asset-' + index),
                    // Git pads the final TAR record to 10 KiB.
                    index === 15 ? chunk.subarray(12 * 1024) : chunk,
                ),
            ).concat(writeFile(join(largeOrigin, 'package.json'), oldManifest)),
        )
        git(largeOrigin, 'add', '-f', '--', '.')
        git(
            largeOrigin,
            'commit',
            '-m',
            'Fixture with bounded tree and larger TAR',
        )
        const admittedCommit = git(largeOrigin, 'rev-parse', 'HEAD').trim()
        const source = { repositoryId: repoId, commit: admittedCommit }
        await expect(
            stageGitSource(
                stage,
                {
                    repository: repoName,
                    path: '.',
                    commit: admittedCommit,
                    source,
                },
                {
                    origin: () => pathToFileURL(largeOrigin),
                    resolve: async (request) => ({ ...request, source }),
                    readTree: async (_repository, tree) =>
                        treeInfo(largeOrigin, tree),
                },
            ),
        ).rejects.toThrow('Submitted Git object exceeds its size limit')
        const outputs = await readdir(stage)
        expect(outputs).not.toContain('source.tar')
        expect(
            outputs.some((name) => name.startsWith('.source-archive-')),
        ).toBe(false)
    }, 15_000)

    test('hydrates only scoped blobs at the requested commit after the branch advances', async () => {
        const stage = await destination('scoped')
        const requestedPath = 'apps/candidate'
        const source = wanted(requestedPath)
        const tree = git(
            origin,
            'rev-parse',
            commit + ':' + requestedPath,
        ).trim()
        const asset = git(
            origin,
            'rev-parse',
            tree + ':assets/message.txt',
        ).trim()
        const outside = git(origin, 'rev-parse', commit + ':outside.txt').trim()
        const transport = localTransport()
        const { dependencies, sourceArchive } = await stageGitSource(
            stage,
            source,
            {
                ...transport,
                async readTree(repository, receivedTree) {
                    expect(receivedTree).toBe(tree)
                    expect(objects(stage).has(asset)).toBe(false)
                    expect(objects(stage).has(outside)).toBe(false)
                    return transport.readTree(repository, receivedTree)
                },
            },
        )

        expect(git(origin, 'rev-parse', 'HEAD').trim()).not.toBe(commit)
        expect(git(stage, 'rev-parse', 'FETCH_HEAD').trim()).toBe(commit)
        expect(objects(stage).has(asset)).toBe(true)
        expect(objects(stage).has(outside)).toBe(false)
        expect(await readFile(join(dependencies, 'package.json'), 'utf8')).toBe(
            oldManifest,
        )
        expect(await readFile(join(dependencies, 'bun.lock'), 'utf8')).toBe(
            originalLock,
        )
        expect(
            command('tar', ['-tf', sourceArchive], stage)
                .trim()
                .split(/\r?\n/u)
                .toSorted(),
        ).toEqual(['assets/', 'assets/message.txt', 'bun.lock', 'package.json'])
        expect(
            command(
                'tar',
                ['-xOf', sourceArchive, 'assets/message.txt'],
                stage,
            ),
        ).toBe('old asset\n')
    }, 15_000)

    test('rejects a mismatching resolved repository before reading its tree data', async () => {
        const stage = await destination('wrong-id')
        const source = wanted('apps/candidate')
        source.source.repositoryId = '10002'
        await expect(
            stageGitSource(
                stage,
                source,
                localTransport({
                    async readTree() {
                        throw new Error('Unexpected tree lookup')
                    },
                }),
            ),
        ).rejects.toThrow('Fetched Git repository differs')
    })

    test('rejects file paths without hydrating the file blob', async () => {
        const stage = await destination('wrong-kind')
        await expect(
            stageGitSource(stage, wanted('outside.txt'), localTransport()),
        ).rejects.toThrow('must be a committed directory')
        expect(
            objects(stage).has(
                git(origin, 'rev-parse', commit + ':outside.txt').trim(),
            ),
        ).toBe(false)
    })

    test.each(['missing', 'invalid'])(
        'requires a committed regular package manifest (%s)',
        async (path) => {
            const stage = await destination('manifest-' + path)
            await expect(
                stageGitSource(stage, wanted(path), localTransport()),
            ).rejects.toThrow('package.json must be a committed regular file')
        },
    )

    test('stages a regular manifest without an optional lock', async () => {
        const stage = await destination('without-lock')
        const { dependencies } = await stageGitSource(
            stage,
            wanted('without-lock'),
            localTransport(),
        )
        expect(await readdir(dependencies)).toEqual(['package.json'])
    })

    test('rejects a transport outside the explicit HTTPS and file protocols', async () => {
        await expect(
            stageGitSource(
                origin,
                wanted('.'),
                localTransport({
                    origin: () => new URL('ssh://example.invalid/repo.git'),
                }),
            ),
        ).rejects.toThrow('Unsupported source Git transport')
    })
})
