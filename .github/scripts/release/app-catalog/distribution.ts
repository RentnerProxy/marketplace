import { z } from 'zod'
import { CANDIDATE_PIPELINE } from '../../../../web/src/config/submissions.config.ts'
import {
    catalogBranch,
    catalogRepository,
    githubHttp,
    oid,
    repositoryPath,
    responseBytes,
} from './github-http.ts'
import { githubReleases } from './github-releases.ts'

const timestampPath = 'metadata/timestamp.json'
const allowedPath =
    /^(?:metadata\/(?:timestamp|[1-9][0-9]*\.(?:root|snapshot|targets))\.json|targets\/[a-f0-9]{64}\.catalog\.json|targets\/assets\/[a-f0-9]{64}\.[a-f0-9]{64}\.(?:png|webp))$/
const maxFileBytes = 64 * 1024 * 1024

const publicRepository = z.object({
    full_name: z
        .string()
        .refine(
            (name) => name.toLowerCase() === catalogRepository.toLowerCase(),
        ),
    owner: z.object({
        type: z.literal('Organization'),
        id: z.literal(Number(CANDIDATE_PIPELINE.officialOwnerId)),
    }),
    default_branch: z.literal(catalogBranch),
    private: z.literal(false),
    visibility: z.literal('public'),
    archived: z.literal(false),
    disabled: z.literal(false),
})

const branchRef = z.object({
    ref: z.literal(`refs/heads/${catalogBranch}`),
    object: z.object({ type: z.literal('commit'), sha: oid }),
})

const branchRulePage = z
    .array(
        z.object({
            type: z.string().min(1),
            ruleset_id: z.number().int().positive(),
            parameters: z.record(z.string(), z.unknown()).optional(),
        }),
    )
    .max(100)

const promotedCommit = z.object({
    errors: z.tuple([]).optional(),
    data: z.object({
        createCommitOnBranch: z.object({ commit: z.object({ oid }) }),
    }),
})

const promotionMutation = `
    mutation PromoteCatalog($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid } }
    }
`

function assertStaticPath(path: string) {
    if (path.length > 192 || !allowedPath.test(path))
        throw new Error('Invalid static catalog path')
}

export function createDistribution(
    token: string,
    fetcher: typeof fetch = fetch,
) {
    const http = githubHttp(token, fetcher)
    let publicRepositoryCheck: Promise<void> | undefined

    async function checkPublicRepository() {
        if (
            !publicRepository.safeParse(
                await http.request({ path: repositoryPath }),
            ).success
        )
            throw new Error(
                'Unexpected public catalog repository identity or state',
            )
    }

    async function assertDistributionRepository() {
        await (publicRepositoryCheck ??= checkPublicRepository())

        // GitHub returns only active rules that apply to this branch. It does not
        // list bypass actors on this endpoint, so the operator configures them.
        const rules: z.infer<typeof branchRulePage> = []
        for (let page = 1; page <= 10; page += 1) {
            const result = branchRulePage.safeParse(
                // eslint-disable-next-line no-await-in-loop -- follow bounded effective rule pages
                await http.request({
                    path: `${repositoryPath}/rules/branches/${catalogBranch}?per_page=100&page=${page}`,
                }),
            )
            if (!result.success)
                throw new Error('Invalid effective catalog branch rules')
            rules.push(...result.data)
            if (result.data.length < 100) break
            if (page === 10)
                throw new Error(
                    'Catalog branch rules pagination limit exceeded',
                )
        }

        const updates = rules.filter(({ type }) => type === 'update')
        const updateRulesets = new Set(
            updates.map(({ ruleset_id }) => ruleset_id),
        )
        const hasRestrictedUpdate = updates.some(
            ({ parameters }) =>
                parameters === undefined ||
                parameters.update_allows_fetch_and_merge === false,
        )
        const activeSafetyRules = new Set(
            rules
                .filter(({ ruleset_id }) => !updateRulesets.has(ruleset_id))
                .map(({ type }) => type),
        )
        if (
            !hasRestrictedUpdate ||
            !activeSafetyRules.has('deletion') ||
            !activeSafetyRules.has('non_fast_forward')
        )
            throw new Error(
                'Catalog main requires restricted updates and separate deletion and non-fast-forward protection',
            )
    }

    async function head() {
        await assertDistributionRepository()
        const result = await http.request({
            path: `${repositoryPath}/git/ref/heads/${catalogBranch}`,
        })
        return branchRef.parse(result).object.sha
    }

    async function readAt(commit: string, path: string, maxBytes: number) {
        oid.parse(commit)
        assertStaticPath(path)
        if (
            !Number.isSafeInteger(maxBytes) ||
            maxBytes < 1 ||
            maxBytes > maxFileBytes
        )
            throw new Error('Invalid static catalog byte limit')
        const response = await http.send(
            `https://raw.githubusercontent.com/${catalogRepository}/${commit}/${path}`,
            { credentials: 'omit' },
            25_000,
        )
        if (response.status !== 200) {
            await response.body?.cancel()
            if (response.status === 404) return null
            throw new Error(
                `Public catalog read returned HTTP ${response.status}`,
            )
        }
        return responseBytes(response, maxBytes)
    }

    async function promote(
        expectedHead: string,
        files: ReadonlyMap<string, Buffer>,
        authorize?: () => Promise<void>,
    ) {
        oid.parse(expectedHead)
        const entries = [...files.entries()]
        if (!entries.length) throw new Error('Missing static catalog files')
        for (const [path, bytes] of entries) {
            assertStaticPath(path)
            if (
                !Buffer.isBuffer(bytes) ||
                !bytes.length ||
                bytes.length > maxFileBytes
            )
                throw new Error('Invalid static catalog file size')
        }
        if ((await head()) !== expectedHead)
            throw new Error(
                'Catalog promotion expected a different public branch head',
            )

        const additions: { path: string; contents: string }[] = []
        for (const [path, bytes] of entries) {
            // eslint-disable-next-line no-await-in-loop -- bound memory across the metadata and target files
            const existing = await readAt(expectedHead, path, maxFileBytes)
            if (existing?.equals(bytes)) continue
            if (existing !== null && path !== timestampPath)
                throw new Error(
                    'Promotion would replace an immutable catalog file',
                )
            additions.push({ path, contents: bytes.toString('base64') })
        }
        if (!additions.length) {
            if ((await head()) !== expectedHead)
                throw new Error(
                    'Public branch changed during catalog promotion',
                )
            return expectedHead
        }

        await authorize?.()
        const result = promotedCommit.safeParse(
            await http.request({
                path: '/graphql',
                method: 'POST',
                body: {
                    query: promotionMutation,
                    variables: {
                        input: {
                            branch: {
                                repositoryNameWithOwner: catalogRepository,
                                branchName: catalogBranch,
                            },
                            expectedHeadOid: expectedHead,
                            message: {
                                headline: 'chore: promote signed app catalog',
                            },
                            fileChanges: { additions },
                        },
                    },
                },
            }),
        )
        if (!result.success)
            throw new Error('GitHub refused the atomic catalog promotion')
        return result.data.data.createCommitOnBranch.commit.oid
    }

    return {
        head,
        readAt,
        promote,
        ...githubReleases(http, assertDistributionRepository),
    }
}
