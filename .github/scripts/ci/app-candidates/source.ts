import {
    link,
    mkdir,
    mkdtemp,
    open,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import {
    commit as commitSha,
    sourceIdentity,
} from '../../../../contracts/v1/primitives.ts'
import {
    repositoryName,
    sourceRequest,
} from '../../../../web/src/lib/Marketplace/sourceRequest.ts'
import { runAppPipeline, runAppPipelineSync } from '../../native-tools.ts'

export { sourceRequest }

export const resolvedSource = sourceRequest.extend({ source: sourceIdentity })

type SourceRequest = z.output<typeof sourceRequest>
type ResolvedSource = SourceRequest & { source: AppManifest['source'] }

const githubRepository = z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    full_name: repositoryName,
    private: z.literal(false),
})

const githubCommit = z.object({ sha: commitSha })
const sourceArchiveBytesLimit = 64 * 1024 * 1024

export function checkSourceTree(value: unknown, expectedTree: string) {
    return runAppPipelineSync<string[]>('source-tree', {
        tree: value,
        expectedTree,
    })
}

async function githubJson(path: string, token?: string): Promise<unknown> {
    const headers = new Headers({
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RentnerProxy-app-candidates',
    })
    if (token) headers.set('Authorization', 'Bearer ' + token)
    const response = await fetch('https://api.github.com' + path, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok)
        throw new Error(
            'GitHub could not verify submitted source (' +
                response.status +
                ')',
        )
    const raw: unknown = await response.json()
    return raw
}

export async function resolveSource(
    input: unknown,
    token?: string,
): Promise<ResolvedSource> {
    const request = sourceRequest.parse(input)
    const repository = githubRepository.parse(
        await githubJson('/repos/' + request.repository, token),
    )
    if (
        repository.full_name.toLowerCase() !== request.repository.toLowerCase()
    ) {
        throw new Error('Submitted GitHub repository identity changed')
    }
    const resolved = githubCommit.parse(
        await githubJson(
            '/repos/' + repository.full_name + '/git/commits/' + request.commit,
            token,
        ),
    )
    if (resolved.sha !== request.commit)
        throw new Error('Submitted source must resolve to the exact commit')
    return {
        ...request,
        repository: repository.full_name,
        source: { repositoryId: String(repository.id), commit: resolved.sha },
    }
}

async function capture(
    args: string[],
    options: {
        cwd: string
        env: Record<string, string | undefined>
        limit: number
        input?: string
    },
    consume: (chunk: Uint8Array) => void | Promise<void>,
) {
    const child = Bun.spawn(args, {
        cwd: options.cwd,
        env: options.env,
        stdin:
            options.input === undefined ? 'ignore' : Buffer.from(options.input),
        stdout: 'pipe',
        stderr: 'ignore',
        signal: AbortSignal.timeout(120_000),
        windowsHide: true,
    })
    let bytes = 0
    try {
        for await (const chunk of child.stdout) {
            bytes += chunk.byteLength
            if (bytes > options.limit)
                throw new Error('Submitted Git object exceeds its size limit')
            // oxlint-disable-next-line no-await-in-loop -- Backpressure bounds pending archive writes.
            await consume(chunk)
        }
        if ((await child.exited) !== 0)
            throw new Error('Could not read the exact submitted Git tree')
        return bytes
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        await child.exited
    }
}

/** Keep submitted Git objects inert on the host and admit only a scoped source tar to the sandbox. */
export async function stageSource(
    directory: string,
    expected: ResolvedSource,
    token?: string,
) {
    return stageGitSource(directory, expected, {
        origin: (repository) =>
            new URL('https://github.com/' + repository + '.git'),
        resolve: (request) => resolveSource(request, token),
        readTree: (repository, tree) =>
            githubJson(
                '/repos/' + repository + '/git/trees/' + tree + '?recursive=1',
                token,
            ),
    })
}

interface GitTransport {
    origin: (repository: string) => URL
    resolve: (request: SourceRequest) => Promise<ResolvedSource>
    readTree: (repository: string, tree: string) => Promise<unknown>
}

/** The caller supplies the trusted transport. Workflow inputs go through stageSource. */
export async function stageGitSource(
    directory: string,
    expected: ResolvedSource,
    transport: GitTransport,
) {
    const request = sourceRequest.parse({
        repository: expected.repository,
        commit: expected.commit,
        path: expected.path,
    })
    const origin = transport.origin(request.repository)
    if (origin.protocol !== 'https:' && origin.protocol !== 'file:') {
        throw new Error('Unsupported source Git transport')
    }
    const protocol = origin.protocol.slice(0, -1)
    const cwd = await realpath(directory)
    const home = join(cwd, 'git-home')
    const dependencies = join(cwd, 'dependencies')
    await Promise.all([mkdir(home), mkdir(dependencies)])
    const readGit = (
        args: string[],
        limit: number,
        input: string | undefined,
        consume: (chunk: Uint8Array) => void | Promise<void>,
    ) =>
        capture(
            [
                'git',
                '-c',
                'protocol.allow=never',
                '-c',
                'protocol.' + protocol + '.allow=always',
                '-c',
                'http.followRedirects=false',
                '-c',
                'fetch.recurseSubmodules=false',
                ...args,
            ],
            {
                cwd,
                limit,
                input,
                env: {
                    PATH: process.env.PATH,
                    SystemRoot: process.env.SystemRoot,
                    HOME: home,
                    XDG_CONFIG_HOME: home,
                    GIT_CONFIG_GLOBAL:
                        process.platform === 'win32' ? 'NUL' : '/dev/null',
                    GIT_CONFIG_NOSYSTEM: '1',
                    GIT_NO_REPLACE_OBJECTS: '1',
                    GIT_TERMINAL_PROMPT: '0',
                },
            },
            consume,
        )
    const captureGit = async (args: string[], limit = 4096, input?: string) => {
        const chunks: Uint8Array[] = []
        const bytes = await readGit(args, limit, input, (chunk) => {
            chunks.push(chunk)
        })
        return Buffer.concat(chunks, bytes)
    }
    await captureGit(['init', '--bare', '--template=', '.'])
    await captureGit(['remote', 'add', 'origin', origin.href])
    await captureGit(['config', 'remote.origin.promisor', 'true'])
    await captureGit([
        'config',
        'remote.origin.partialclonefilter',
        'blob:none',
    ])
    await captureGit([
        'fetch',
        '--no-tags',
        '--depth=1',
        '--filter=blob:none',
        'origin',
        request.commit,
    ])
    const fetched = (
        await captureGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
    )
        .toString()
        .trim()
    if (fetched !== expected.source.commit)
        throw new Error(
            'Fetched source commit differs from the resolved commit',
        )
    const rechecked = await transport.resolve(request)
    if (
        rechecked.source.repositoryId !== expected.source.repositoryId ||
        rechecked.source.commit !== fetched
    ) {
        throw new Error(
            'Fetched Git repository differs from the resolved source',
        )
    }
    const tree =
        request.path === '.'
            ? commitSha.parse(
                  (
                      await captureGit([
                          'rev-parse',
                          '--verify',
                          fetched + '^{tree}',
                      ])
                  )
                      .toString()
                      .trim(),
              )
            : await findCommittedDirectory(captureGit, fetched, request.path)
    // Admit the scoped tree's size before any blob reads hydrate the shallow
    // partial fetch. GitHub reports truncation explicitly and we fail closed.
    const blobs = await runAppPipeline<string[]>('source-tree', {
        tree: await transport.readTree(rechecked.repository, tree),
        expectedTree: tree,
    })
    if (blobs.length > 0) {
        // Git can request the admitted object IDs in one conversation. This
        // keeps large trees from causing a separate lazy fetch for each file.
        await captureGit(
            [
                'fetch',
                '--no-tags',
                '--no-write-fetch-head',
                '--filter=blob:none',
                '--stdin',
                'origin',
            ],
            4096,
            blobs.join('\n') + '\n',
        )
    }
    await Promise.all(
        ['package.json', 'bun.lock'].map(async (name) => {
            const entry = (
                await captureGit(['ls-tree', tree, '--', name])
            ).toString()
            const { present, limit } = await runAppPipeline<{
                present: boolean
                limit: number
            }>('source-staged-file', { name, entry })
            if (!present) return
            await writeFile(
                join(dependencies, name),
                await captureGit(
                    ['cat-file', 'blob', tree + ':' + name],
                    limit,
                ),
                { mode: 0o644, flag: 'wx' },
            )
        }),
    )
    const sourceArchive = join(cwd, 'source.tar')
    const temporary = await mkdtemp(join(cwd, '.source-archive-'))
    try {
        const stagedPath = join(temporary, 'source.tar')
        const file = await open(stagedPath, 'wx', 0o644)
        try {
            await readGit(
                ['archive', '--format=tar', tree],
                sourceArchiveBytesLimit,
                undefined,
                (chunk) => file.writeFile(chunk),
            )
        } finally {
            await file.close()
        }
        await link(stagedPath, sourceArchive)
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
    return { sourceArchive, dependencies }
}

async function findCommittedDirectory(
    git: (args: string[]) => Promise<Buffer>,
    commit: string,
    path: string,
) {
    // Inspect mode and type from the tree entry without fetching a blob if
    // the submitted directory name actually resolves to a file.
    const entry = (
        await git(['ls-tree', '-d', '-z', commit, '--', path])
    ).toString()
    return runAppPipeline<string>('source-directory', { entry, path })
}
