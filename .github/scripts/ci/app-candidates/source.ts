import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import { sourceIdentity } from '../../../../contracts/v1/primitives.ts'

const repositoryName = z
    .string()
    .max(140)
    .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/,
    )
const commitSha = z.string().regex(/^[a-f0-9]{40}$/)
const sourcePath = z
    .string()
    .max(200)
    .regex(/^(?:\.|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)$/)
    .refine(
        (value) =>
            value === '.' ||
            value
                .split('/')
                .every(
                    (part) =>
                        part !== '.' &&
                        part !== '..' &&
                        part.toLowerCase() !== '.git',
                ),
    )

export const sourceRequest = z.strictObject({
    repository: repositoryName,
    commit: commitSha,
    path: sourcePath,
})
export const resolvedSource = sourceRequest.extend({ source: sourceIdentity })

type SourceRequest = z.output<typeof sourceRequest>
type ResolvedSource = SourceRequest & { source: AppManifest['source'] }

const githubRepository = z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    full_name: repositoryName,
    private: z.literal(false),
})

const githubCommit = z.object({ sha: commitSha })
const manifestBytesLimit = 1024 * 1024
const lockBytesLimit = 8 * 1024 * 1024
const sourceArchiveBytesLimit = 64 * 1024 * 1024

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
    },
) {
    const process = Bun.spawn(args, {
        cwd: options.cwd,
        env: options.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        signal: AbortSignal.timeout(120_000),
        windowsHide: true,
    })
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of process.stdout) {
        bytes += chunk.byteLength
        if (bytes > options.limit) {
            process.kill()
            await process.exited
            throw new Error('Submitted Git object exceeds its size limit')
        }
        chunks.push(chunk)
    }
    if ((await process.exited) !== 0)
        throw new Error('Could not read the exact submitted Git tree')
    return Buffer.concat(chunks, bytes)
}

/** Keep submitted Git objects inert on the host and admit only a scoped source tar to the sandbox. */
export async function stageSource(
    directory: string,
    expected: ResolvedSource,
    token?: string,
) {
    const request = sourceRequest.parse({
        repository: expected.repository,
        commit: expected.commit,
        path: expected.path,
    })
    const cwd = await realpath(directory)
    const home = join(cwd, 'git-home')
    const dependencies = join(cwd, 'dependencies')
    await Promise.all([mkdir(home), mkdir(dependencies)])
    const captureGit = (args: string[], limit = 4096) =>
        capture(
            [
                'git',
                '-c',
                'protocol.allow=never',
                '-c',
                'protocol.https.allow=always',
                '-c',
                'http.followRedirects=false',
                '-c',
                'fetch.recurseSubmodules=false',
                ...args,
            ],
            {
                cwd,
                limit,
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
        )
    await captureGit(['init', '--bare', '--template=', '.'])
    await captureGit([
        'fetch',
        '--no-tags',
        '--depth=1',
        'https://github.com/' + request.repository + '.git',
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
    const rechecked = await resolveSource(request, token)
    if (
        rechecked.source.repositoryId !== expected.source.repositoryId ||
        rechecked.source.commit !== fetched
    ) {
        throw new Error(
            'Fetched Git repository differs from the resolved source',
        )
    }
    const tree = commitSha.parse(
        (
            await captureGit([
                'rev-parse',
                '--verify',
                fetched +
                    (request.path === '.' ? '^{tree}' : ':' + request.path),
            ])
        )
            .toString()
            .trim(),
    )
    if (
        (await captureGit(['cat-file', '-t', tree])).toString().trim() !==
        'tree'
    ) {
        throw new Error('Submitted source path must be a committed directory')
    }
    const stagedFiles = [
        { name: 'package.json', limit: manifestBytesLimit, required: true },
        { name: 'bun.lock', limit: lockBytesLimit, required: false },
    ]
    await Promise.all(
        stagedFiles.map(async ({ name, limit, required }) => {
            const entry = (await captureGit(['ls-tree', tree, '--', name]))
                .toString()
                .trimEnd()
            if (!required && entry === '') return
            if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry)) {
                throw new Error(
                    'Submitted ' + name + ' must be a committed regular file',
                )
            }
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
    const tar = await captureGit(
        ['archive', '--format=tar', tree],
        sourceArchiveBytesLimit,
    )
    await writeFile(sourceArchive, tar, { mode: 0o644, flag: 'wx' })
    return { sourceArchive, dependencies }
}
