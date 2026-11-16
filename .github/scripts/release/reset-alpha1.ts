import { GitHubRequestError, record } from '../automation/github.ts'
import type {
    Alpha1Context,
    Alpha1Request,
} from './Types/reset-alpha1.types.ts'

// Immutable incident identities: this workflow must never reset a rebuilt Alpha1.
export const originalAlpha1 = {
    repository: 'RentnerProxy/marketplace',
    tag: 'v1.0.0-alpha.1',
    commit: '3a5ebf2118617764c1c86765c6a9e887a2d6b0e2',
    tagObject: '6481e5a331b5d4bc75108c879be9db7376ba05aa',
    releaseId: 446488748,
    digest: 'sha256:b9bb3a90254fe7306a0052c5f66717866e979b0a7cd2e3dfb039b179d1138396',
} as const

const repositoryPath = '/repos/RentnerProxy/marketplace'
const packagePath = '/orgs/RentnerProxy/packages/container/marketplace'
const releasePath = `${repositoryPath}/releases/tags/${originalAlpha1.tag}`

function requireIdentity(
    condition: boolean,
    resource: string,
): asserts condition {
    if (!condition)
        throw new Error(`Original Alpha1 ${resource} identity mismatch`)
}

function positiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function validateResetContext(context: Alpha1Context) {
    requireIdentity(
        context.repository === originalAlpha1.repository &&
            context.event === 'workflow_dispatch' &&
            context.ref === 'refs/heads/main' &&
            context.workflowRef ===
                `${originalAlpha1.repository}/.github/workflows/reset-alpha1.yml@refs/heads/main` &&
            context.serverUrl === 'https://github.com' &&
            context.apiUrl === 'https://api.github.com',
        'trusted workflow',
    )
}

async function readRelease(request: Alpha1Request) {
    try {
        const release = record(await request('GET', releasePath))
        requireIdentity(
            positiveId(release.id) &&
                release.id === originalAlpha1.releaseId &&
                release.tag_name === originalAlpha1.tag,
            'release',
        )
        return release.id as number
    } catch (error) {
        if (error instanceof GitHubRequestError && error.status === 404)
            return undefined
        throw error
    }
}

export async function resetOriginalAlpha1(
    request: Alpha1Request,
    context: Alpha1Context,
) {
    validateResetContext(context)
    const repository = record(await request('GET', repositoryPath))
    requireIdentity(
        repository.full_name === originalAlpha1.repository &&
            repository.default_branch === 'main',
        'repository',
    )
    const ref = record(
        await request(
            'GET',
            `${repositoryPath}/git/ref/tags/${originalAlpha1.tag}`,
        ),
    )
    const object = record(ref.object)
    requireIdentity(
        ref.ref === `refs/tags/${originalAlpha1.tag}` &&
            object.type === 'tag' &&
            object.sha === originalAlpha1.tagObject,
        'tag ref',
    )
    const tag = record(
        await request(
            'GET',
            `${repositoryPath}/git/tags/${originalAlpha1.tagObject}`,
        ),
    )
    const target = record(tag.object)
    requireIdentity(
        tag.sha === originalAlpha1.tagObject &&
            tag.tag === originalAlpha1.tag &&
            target.type === 'commit' &&
            target.sha === originalAlpha1.commit,
        'tag commit',
    )
    const releaseId = await readRelease(request)
    const pkg = record(await request('GET', packagePath))
    requireIdentity(
        pkg.name === 'marketplace' &&
            pkg.package_type === 'container' &&
            record(pkg.repository).full_name === originalAlpha1.repository,
        'package',
    )

    let versionId: number | undefined
    const ids = new Set<number>()
    for (let page = 1; ; page += 1) {
        requireIdentity(page <= 30, 'package pagination')
        // eslint-disable-next-line no-await-in-loop -- validate every page before any deletion
        const versions: unknown = await request(
            'GET',
            `${packagePath}/versions?state=active&per_page=100&page=${page}`,
        )
        requireIdentity(Array.isArray(versions), 'package versions')
        for (const entry of versions as unknown[]) {
            const version = record(entry)
            requireIdentity(
                positiveId(version.id) && !ids.has(version.id),
                'package version ID',
            )
            ids.add(version.id)
            const tags = record(record(version.metadata).container).tags
            requireIdentity(
                Array.isArray(tags) &&
                    tags.every((value) => typeof value === 'string'),
                'package tags',
            )
            const names = tags
            if (version.name === originalAlpha1.digest) {
                requireIdentity(
                    versionId === undefined &&
                        names.includes(originalAlpha1.tag) &&
                        names.every(
                            (name) =>
                                name === originalAlpha1.tag || name === 'alpha',
                        ),
                    'original package version',
                )
                versionId = version.id
            } else {
                requireIdentity(
                    !names.includes(originalAlpha1.tag) &&
                        !names.includes('alpha'),
                    'replacement package version',
                )
            }
        }
        if ((versions as unknown[]).length < 100) break
    }
    // All remote reads and identity checks finish before the first destructive call.
    if (versionId !== undefined)
        await request('DELETE', `${packagePath}/versions/${versionId}`)
    if (releaseId !== undefined)
        await request('DELETE', `${repositoryPath}/releases/${releaseId}`)
    return {
        packageDeleted: versionId !== undefined,
        releaseDeleted: releaseId !== undefined,
    }
}

export function createAlpha1Request(token: string): Alpha1Request {
    if (!token.trim()) throw new Error('Missing GitHub Actions token')
    return async (method, path) => {
        // This token can address only this repository and its one container package.
        requireIdentity(
            path === repositoryPath ||
                path.startsWith(`${repositoryPath}/`) ||
                path === packagePath ||
                path.startsWith(`${packagePath}/`),
            'API path',
        )
        const response = await fetch(`https://api.github.com${path}`, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new GitHubRequestError(response.status)
        if (method === 'DELETE') {
            requireIdentity(response.status === 204, 'delete response')
            return undefined
        }
        return response.json() as Promise<unknown>
    }
}

if (import.meta.main) {
    const result = await resetOriginalAlpha1(
        createAlpha1Request(process.env.GH_TOKEN ?? ''),
        {
            repository: process.env.GITHUB_REPOSITORY ?? '',
            event: process.env.GITHUB_EVENT_NAME ?? '',
            ref: process.env.GITHUB_REF ?? '',
            workflowRef: process.env.GITHUB_WORKFLOW_REF ?? '',
            serverUrl: process.env.GITHUB_SERVER_URL ?? '',
            apiUrl: process.env.GITHUB_API_URL ?? '',
        },
    )
    console.log(
        `Original broken Alpha1 reset: package ${result.packageDeleted ? 'deleted' : 'already absent'}, release ${result.releaseDeleted ? 'deleted' : 'already absent'}. Tag unchanged.`,
    )
}
