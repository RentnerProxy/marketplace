import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDistribution } from '../../../../../.github/scripts/release/app-catalog/distribution.ts'
import fixtures from '../../../../../contracts/v1/fixtures.json'
import {
    packageReleaseAssets,
    parseCatalog,
} from '../../../../../contracts/v1/index.ts'

const repository = '/repos/RentnerProxy/app-catalog'
const branch = `${repository}/git/ref/heads/main`
const branchRulesPath = `${repository}/rules/branches/main`
const releases = `${repository}/releases`
const parent = '1'.repeat(40)
const child = '2'.repeat(40)
const token = 'github-app-fixture-token'
const oldPath = 'metadata/1.root.json'
const timestampPath = 'metadata/timestamp.json'
const targetsPath = 'metadata/1.targets.json'
const repo = {
    full_name: 'RentnerProxy/app-catalog',
    owner: { type: 'Organization', id: 353739658 },
    default_branch: 'main',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
}
const branchRules = [
    { type: 'deletion', ruleset_id: 1 },
    { type: 'non_fast_forward', ruleset_id: 1 },
    {
        type: 'update',
        ruleset_id: 2,
        parameters: { update_allows_fetch_and_merge: false },
    },
]

function branchRulesResponse(options: RequestInit) {
    expect(new Headers(options.headers).get('authorization')).toBe(
        `Bearer ${token}`,
    )
    return Response.json(branchRules)
}

function identity(bytes: string) {
    return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: Buffer.byteLength(bytes),
    }
}

function rawResponse(body: string) {
    return new Response(body, { status: 200 })
}

function missing() {
    return new Response(null, { status: 404 })
}

function branchRef(sha = parent) {
    return Response.json({
        ref: 'refs/heads/main',
        object: { type: 'commit', sha },
    })
}

function fixtureFetch(
    handler: (url: URL, options: RequestInit) => Promise<Response> | Response,
) {
    return ((url: string, options: RequestInit) => {
        expect(options.redirect).toBe('manual')
        const parsed = new URL(url)
        const authenticated =
            parsed.hostname === 'api.github.com' ||
            parsed.hostname === 'uploads.github.com'
        expect(new Headers(options.headers).get('authorization')).toBe(
            authenticated ? `Bearer ${token}` : null,
        )
        return handler(parsed, options)
    }) as typeof fetch
}

function assertAnonymous(options: RequestInit) {
    expect(new Headers(options.headers).has('authorization')).toBe(false)
}

async function refuseAuthorization() {
    throw new Error('A rejected release must not request authorization')
}

test('uses the installation token when anonymous repository reads are rate limited', async () => {
    const authenticatedFetch = fixtureFetch((url, options) => {
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        expect(url.pathname).toBe(branch)
        return branchRef()
    })
    const fetcher = ((url: string, options: RequestInit) => {
        if (!new Headers(options.headers).has('authorization'))
            return Promise.resolve(new Response(null, { status: 403 }))
        return authenticatedFetch(url, options)
    }) as typeof fetch

    await expect(createDistribution(token, fetcher).head()).resolves.toBe(
        parent,
    )
})

test('identifies a rate-limited repository request without exposing its body', async () => {
    const fetcher = fixtureFetch((url) => {
        expect(url.pathname).toBe(repository)
        return new Response('private response details', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
        })
    })
    await expect(createDistribution(token, fetcher).head()).rejects.toThrow(
        'GitHub catalog API GET /repos/RentnerProxy/app-catalog returned HTTP 403 (rate limited)',
    )
})

test('promotes signed catalog files in one commit against the exact public head', async () => {
    const mutations: unknown[] = []
    let repositoryReads = 0
    let headReads = 0
    let rawReads = 0
    let authorized = false
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === '/graphql') {
            expect(authorized).toBe(true)
            expect(new Headers(options.headers).get('authorization')).toBe(
                `Bearer ${token}`,
            )
            expect(typeof options.body).toBe('string')
            mutations.push(JSON.parse(String(options.body)))
            return Response.json({
                data: { createCommitOnBranch: { commit: { oid: child } } },
            })
        }
        if (url.pathname === repository) {
            repositoryReads += 1
            return Response.json(repo)
        }
        if (url.pathname === branch) {
            headReads += 1
            return branchRef(headReads > 2 ? child : parent)
        }
        rawReads += 1
        expect(url.host).toBe('raw.githubusercontent.com')
        expect(url.pathname).toContain(`/RentnerProxy/app-catalog/${parent}/`)
        if (url.pathname.endsWith(oldPath)) return rawResponse('old root')
        if (url.pathname.endsWith(timestampPath))
            return rawResponse('old timestamp')
        return missing()
    })
    const distribution = createDistribution(token, fetcher)
    expect(await distribution.head()).toBe(parent)
    expect(
        await distribution.promote(
            parent,
            new Map([
                [oldPath, Buffer.from('old root')],
                [timestampPath, Buffer.from('new timestamp')],
                [targetsPath, Buffer.from('new targets')],
            ]),
            async () => {
                expect(rawReads).toBe(3)
                authorized = true
            },
        ),
    ).toBe(child)
    expect(await distribution.head()).toBe(child)
    expect(repositoryReads).toBe(1)
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
        variables: {
            input: {
                branch: {
                    repositoryNameWithOwner: 'RentnerProxy/app-catalog',
                    branchName: 'main',
                },
                expectedHeadOid: parent,
                fileChanges: {
                    additions: [
                        {
                            path: timestampPath,
                            contents:
                                Buffer.from('new timestamp').toString('base64'),
                        },
                        {
                            path: targetsPath,
                            contents:
                                Buffer.from('new targets').toString('base64'),
                        },
                    ],
                },
            },
        },
    })
})

test('rejects oversized reads, unsafe paths and rewrites of immutable files', async () => {
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branch) return branchRef()
        return rawResponse('fixed bytes')
    })
    const distribution = createDistribution(token, fetcher)
    await expect(distribution.readAt(parent, '../config', 128)).rejects.toThrow(
        'static catalog path',
    )
    await expect(distribution.readAt(parent, oldPath, 1)).rejects.toThrow(
        'permitted length',
    )
    await expect(
        distribution.promote(
            parent,
            new Map([[oldPath, Buffer.from('replace')]]),
        ),
    ).rejects.toThrow('immutable')
})

test('fails closed on a concurrent GitHub branch update without retrying a write', async () => {
    let mutations = 0
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branch) return branchRef()
        if (url.pathname === '/graphql') {
            mutations += 1
            return Response.json({
                errors: [{ message: 'expected head mismatch' }],
            })
        }
        return missing()
    })
    await expect(
        createDistribution(token, fetcher).promote(
            parent,
            new Map([[timestampPath, Buffer.from('update')]]),
        ),
    ).rejects.toThrow('atomic catalog promotion')
    expect(mutations).toBe(1)
})

test.each([
    { ...repo, private: true },
    { ...repo, owner: { ...repo.owner, id: 1234 } },
    { ...repo, default_branch: 'anything-else' },
])(
    'requires public catalog identity pinned to the organization and main',
    async (wrongRepo) => {
        const fetcher = fixtureFetch((url) => {
            expect(url.pathname).toBe(repository)
            return Response.json(wrongRepo)
        })
        await expect(createDistribution(token, fetcher).head()).rejects.toThrow(
            'repository identity',
        )
    },
)

test.each([
    { records: [], error: 'requires restricted updates' },
    {
        records: [{ type: 'non_fast_forward', ruleset_id: '1' }],
        error: 'Invalid effective',
    },
    {
        records: [
            branchRules[0],
            branchRules[1],
            { type: 'update', ruleset_id: 1 },
        ],
        error: 'separate deletion',
    },
    {
        records: [
            branchRules[0],
            branchRules[1],
            {
                ...branchRules[2],
                parameters: { update_allows_fetch_and_merge: true },
            },
        ],
        error: 'requires restricted updates',
    },
])(
    'requires active and separate branch rules before touching main',
    async ({ records, error }) => {
        const fetcher = fixtureFetch((url) => {
            if (url.pathname === repository) return Response.json(repo)
            expect(url.pathname).toBe(branchRulesPath)
            return Response.json(records)
        })
        await expect(createDistribution(token, fetcher).head()).rejects.toThrow(
            error,
        )
    },
)

test('does not write a catalog commit if the final authorization fails', async () => {
    let attemptedWrite = false
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === branch) return branchRef()
        if (url.pathname === '/graphql') attemptedWrite = true
        return missing()
    })
    const distribution = createDistribution(token, fetcher)
    await expect(
        distribution.promote(
            parent,
            new Map([[timestampPath, Buffer.from('update')]]),
            async () => {
                throw new Error('Approval changed')
            },
        ),
    ).rejects.toThrow('Approval changed')
    expect(attemptedWrite).toBe(false)
})

const releaseFixture = {
    ...fixtures.records.release,
    appId: 'example.monitoring',
    publisher: { namespace: 'example', name: 'Example' },
    packages: [
        {
            manifest: { ...fixtures.manifest, id: 'example.monitoring' },
            manifestSha256: fixtures.targets[0]!.manifestSha256,
            archive: identity('package'),
            sbom: identity('bom'),
            provenance: identity('attestation'),
        },
    ],
}
const release = parseCatalog({
    ...fixtures.records.catalog,
    releases: [releaseFixture],
}).releases[0]!
const releaseAssets = packageReleaseAssets(release.packages[0])
const tag = `${release.appId}-v${release.version}`
const entry = {
    id: 92,
    tag_name: tag,
    prerelease: true,
    body: 'App package and evidence managed by RentnerProxy Marketplace.',
    target_commitish: 'main',
}
const assets = [
    [releaseAssets.archive.url, 'package'],
    [releaseAssets.sbom.url, 'bom'],
    [releaseAssets.provenance.url, 'attestation'],
].map(([url, bytes], index) => ({
    id: index + 1,
    name: new URL(url).pathname.split('/').at(-1)!,
    browser_download_url: url,
    bytes,
    state: 'uploaded',
    size: identity(bytes).sizeBytes,
    digest: `sha256:${identity(bytes).sha256}`,
}))

test('resumes an exact draft, authorizes publication after upload and verifies anonymous byte downloads', async () => {
    let published = false
    let settingsAvailable = false
    let authorized = false
    let uploadCount = 0
    let activeAssets = [
        assets[0]!,
        { ...assets[1]!, state: 'starter', digest: null, size: 0 },
    ]
    const fetcher = fixtureFetch(async (url, options) => {
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.hostname === 'github.com') {
            assertAnonymous(options)
            const asset = assets.find(
                (item) => item.browser_download_url === url.href,
            )
            return new Response(null, {
                status: 302,
                headers: {
                    location: `https://release-assets.githubusercontent.com/${asset!.id}`,
                },
            })
        }
        if (url.hostname === 'release-assets.githubusercontent.com') {
            assertAnonymous(options)
            return rawResponse(assets[Number(url.pathname.slice(1)) - 1]!.bytes)
        }
        if (url.hostname === 'uploads.github.com') {
            expect(authorized).toBe(false)
            expect(options.method).toBe('POST')
            expect(new Headers(options.headers).get('authorization')).toBe(
                `Bearer ${token}`,
            )
            const asset = assets.find(
                ({ name }) => name === url.searchParams.get('name'),
            )!
            expect(await (options.body as Blob).text()).toBe(asset.bytes)
            activeAssets = [...activeAssets, asset]
            uploadCount += 1
            return Response.json(asset)
        }
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === `${repository}/immutable-releases`)
            return settingsAvailable && !published
                ? Response.json({ enabled: true })
                : new Response(null, { status: 503 })
        if (url.pathname === `${releases}/tags/${tag}`) {
            return published
                ? Response.json({ ...entry, draft: false, immutable: true })
                : missing()
        }
        if (url.pathname === releases && options.method === 'GET')
            return Response.json([{ ...entry, draft: true, immutable: false }])
        if (url.pathname === `${releases}/assets/${assets[1]!.id}`) {
            expect(options.method).toBe('DELETE')
            activeAssets = activeAssets.filter(
                ({ state }) => state !== 'starter',
            )
            return new Response(null, { status: 204 })
        }
        if (url.pathname === `${releases}/${entry.id}/assets`)
            return Response.json(activeAssets)
        if (url.pathname === `${repository}/git/ref/tags/${tag}`) {
            if (!published) return missing()
            return Response.json({
                ref: `refs/tags/${tag}`,
                object: { type: 'commit', sha: parent },
            })
        }
        expect(url.pathname).toBe(`${releases}/${entry.id}`)
        expect(options.method).toBe('PATCH')
        expect(authorized).toBe(true)
        published = true
        return Response.json({ ...entry, draft: false, immutable: true })
    })
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-distribution-'))
    try {
        const files = new Map(
            await Promise.all(
                assets.map(async ({ name, bytes }) => {
                    const path = join(directory, name)
                    await writeFile(path, bytes)
                    return [name, path] as const
                }),
            ),
        )
        const distribution = createDistribution(token, fetcher)
        await expect(
            distribution.ensureRelease(release, files, async () => {
                throw new Error('Settings must first be verified')
            }),
        ).rejects.toThrow('HTTP 503')
        expect(uploadCount).toBe(0)
        settingsAvailable = true
        await expect(
            distribution.ensureRelease(release, files, async () => {
                throw new Error('Approval changed')
            }),
        ).rejects.toThrow('Approval changed')
        expect(published).toBe(false)
        await distribution.ensureRelease(release, files, async () => {
            expect(uploadCount).toBe(2)
            authorized = true
        })
        expect(published).toBe(true)
        await distribution.ensureRelease(release, files, async () => {
            throw new Error('An existing release does not need publication')
        })
        await expect(
            distribution.discardUnpublishedDraft(release, async () => {
                throw new Error('A published release cannot be discarded')
            }),
        ).rejects.toThrow('Cannot discard an already published catalog release')
        expect(uploadCount).toBe(2)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('rejects mutable releases, mismatched anonymous bytes and redirects outside GitHub', async () => {
    let immutable = false
    let redirect = false
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.hostname === 'github.com') {
            assertAnonymous(options)
            if (redirect) return Response.redirect('https://example.com/asset')
            return rawResponse('tamper!')
        }
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === `${repository}/immutable-releases`)
            return Response.json({ enabled: true })
        if (url.pathname === `${releases}/tags/${tag}`)
            return Response.json({ ...entry, draft: false, immutable })
        if (url.pathname === `${repository}/git/ref/tags/${tag}`)
            return Response.json({
                ref: `refs/tags/${tag}`,
                object: { type: 'commit', sha: parent },
            })
        expect(url.pathname).toBe(`${releases}/${entry.id}/assets`)
        return Response.json(assets)
    })
    const distribution = createDistribution(token, fetcher)
    await expect(distribution.verifyRelease(release)).rejects.toThrow('mutable')
    immutable = true
    await expect(distribution.verifyRelease(release)).rejects.toThrow(
        'bytes differ',
    )
    redirect = true
    await expect(distribution.verifyRelease(release)).rejects.toThrow(
        'Invalid GitHub release asset redirect',
    )
})

test('detects and verifies an immutable release during a repository settings outage', async () => {
    let releaseReads = 0
    let settingsReads = 0
    let downloadsAvailable = false
    const downloads: string[] = []
    const fetcher = fixtureFetch((url, options) => {
        expect(options.method ?? 'GET').toBe('GET')
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === `${repository}/immutable-releases`) {
            settingsReads += 1
            return new Response(null, { status: 503 })
        }
        if (url.pathname === `${releases}/tags/${tag}`) {
            releaseReads += 1
            return Response.json({ ...entry, draft: false, immutable: true })
        }
        if (url.pathname === `${repository}/git/ref/tags/${tag}`)
            return Response.json({
                ref: `refs/tags/${tag}`,
                object: { type: 'commit', sha: parent },
            })
        if (url.pathname === `${releases}/${entry.id}/assets`)
            return Response.json(assets)
        const asset = assets.find(
            ({ browser_download_url }) => browser_download_url === url.href,
        )
        if (!asset) throw new Error('Unexpected HTTP request')
        downloads.push(url.href)
        return downloadsAvailable
            ? rawResponse(asset.bytes)
            : new Response(null, { status: 503 })
    })
    const distribution = createDistribution(token, fetcher)
    expect(await distribution.inspectRelease(release)).toBe('published')
    expect(releaseReads).toBe(1)
    expect(downloads).toEqual([])
    await expect(distribution.verifyRelease(release)).rejects.toThrow(
        'download returned HTTP 503',
    )
    expect(downloads.length).toBeGreaterThan(0)
    downloads.length = 0
    downloadsAvailable = true
    await distribution.verifyRelease(release)
    expect(downloads).toEqual(
        assets.map(({ browser_download_url }) => browser_download_url),
    )
    expect(settingsReads).toBe(0)
})

test('distinguishes a missing publication from an exact draft and rejects conflicting identities', async () => {
    let mode: 'absent' | 'tag' | 'draft' | 'foreign-draft' = 'absent'
    const fetcher = fixtureFetch((url, options) => {
        expect(options.method ?? 'GET').toBe('GET')
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === `${releases}/tags/${tag}`) return missing()
        if (url.pathname === releases) {
            if (mode === 'draft' || mode === 'foreign-draft') {
                const body =
                    mode === 'draft' ? entry.body : 'a different publisher'
                return Response.json([
                    { ...entry, body, draft: true, immutable: false },
                ])
            }
            return Response.json([])
        }
        if (url.pathname === `${releases}/${entry.id}/assets`)
            return Response.json(assets.slice(0, 1))
        expect(url.pathname).toBe(`${repository}/git/ref/tags/${tag}`)
        return mode === 'tag'
            ? Response.json({
                  ref: `refs/tags/${tag}`,
                  object: { type: 'commit', sha: parent },
              })
            : missing()
    })
    const distribution = createDistribution(token, fetcher)
    expect(await distribution.inspectRelease(release)).toBe('absent')
    mode = 'tag'
    await expect(distribution.inspectRelease(release)).rejects.toThrow(
        'without a verified immutable release',
    )
    mode = 'draft'
    expect(await distribution.inspectRelease(release)).toBe('draft')
    mode = 'foreign-draft'
    await expect(distribution.inspectRelease(release)).rejects.toThrow(
        'different publisher',
    )
})

test('rejects duplicate catalog releases and unexpected or repeated assets without writing', async () => {
    let published = false
    let listed: object[] = []
    let listedAssets: object[] = []
    const writes: string[] = []
    const fetcher = fixtureFetch((url, options) => {
        if ((options.method ?? 'GET') !== 'GET') {
            writes.push(`${options.method} ${url.pathname}`)
            return new Response(null, { status: 204 })
        }
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === `${repository}/immutable-releases`)
            return Response.json({ enabled: true })
        if (url.pathname === `${releases}/tags/${tag}`)
            return published
                ? Response.json({ ...entry, draft: false, immutable: true })
                : missing()
        if (url.pathname === releases) return Response.json(listed)
        if (url.pathname === `${releases}/${entry.id}/assets`)
            return Response.json(listedAssets)
        expect(url.pathname).toBe(`${repository}/git/ref/tags/${tag}`)
        return published
            ? Response.json({
                  ref: `refs/tags/${tag}`,
                  object: { type: 'commit', sha: parent },
              })
            : missing()
    })
    const distribution = createDistribution(token, fetcher)
    // Local paths are never read because every check fails before an upload.
    const files = new Map(
        assets.map(({ name }) => [name, join(tmpdir(), name)] as const),
    )
    const draft = { ...entry, draft: true, immutable: false }

    listed = [draft, { ...draft, id: entry.id + 1 }]
    for (const operation of [
        () => distribution.inspectRelease(release),
        () => distribution.ensureRelease(release, files, refuseAuthorization),
        () =>
            distribution.discardUnpublishedDraft(release, refuseAuthorization),
    ])
        // oxlint-disable-next-line no-await-in-loop -- check each operation in order
        await expect(operation()).rejects.toThrow(
            'duplicate releases for the catalog tag',
        )

    const unexpected = {
        ...assets[0]!,
        id: 9,
        name: 'unexpected.tar.zst',
        browser_download_url: `https://github.com/RentnerProxy/app-catalog/releases/download/${tag}/unexpected.tar.zst`,
    }
    listed = [draft]
    for (const variant of [[assets[0]!, assets[0]!], [unexpected]]) {
        listedAssets = variant
        for (const operation of [
            () => distribution.inspectRelease(release),
            () =>
                distribution.ensureRelease(release, files, refuseAuthorization),
            () =>
                distribution.discardUnpublishedDraft(
                    release,
                    refuseAuthorization,
                ),
        ])
            // oxlint-disable-next-line no-await-in-loop -- check each operation in order
            await expect(operation()).rejects.toThrow(
                'unexpected or duplicate asset',
            )
    }

    published = true
    for (const variant of [
        [assets[0]!, assets[0]!, assets[1]!],
        [assets[0]!, assets[1]!, unexpected],
    ]) {
        listedAssets = variant
        // oxlint-disable-next-line no-await-in-loop -- check each variant in order
        await expect(distribution.verifyRelease(release)).rejects.toThrow(
            'unexpected or duplicate asset',
        )
    }
    expect(writes).toEqual([])
})

test('discards only an exact authorized draft and confirms absence before returning', async () => {
    let draftExists = true
    let badAsset = true
    let observableRemoval = false
    const operations: string[] = []
    const fetcher = fixtureFetch((url, options) => {
        if (url.pathname === repository) return Response.json(repo)
        if (url.pathname === branchRulesPath)
            return branchRulesResponse(options)
        if (url.pathname === `${releases}/tags/${tag}`) return missing()
        if (url.pathname === `${repository}/git/ref/tags/${tag}`)
            return missing()
        if (url.pathname === releases) {
            operations.push('list releases')
            return Response.json(
                draftExists
                    ? [{ ...entry, draft: true, immutable: false }]
                    : [],
            )
        }
        if (url.pathname === `${releases}/${entry.id}/assets`)
            return Response.json([
                { ...assets[0], size: badAsset ? 99 : assets[0]?.size },
            ])
        expect(url.pathname).toBe(`${releases}/${entry.id}`)
        expect(options.method).toBe('DELETE')
        operations.push('delete')
        if (observableRemoval) draftExists = false
        return new Response(null, { status: 204 })
    })
    const distribution = createDistribution(token, fetcher)
    const authorize = async () => {
        operations.push('authorize')
    }
    await expect(
        distribution.discardUnpublishedDraft(release, authorize),
    ).rejects.toThrow('asset differs')
    expect(operations).toEqual(['list releases'])
    badAsset = false
    await expect(
        distribution.discardUnpublishedDraft(release, async () => {
            throw new Error('Cleanup authorization changed')
        }),
    ).rejects.toThrow('authorization changed')
    expect(operations).not.toContain('delete')
    await expect(
        distribution.discardUnpublishedDraft(release, authorize),
    ).rejects.toThrow('Cannot confirm')
    expect(operations.slice(-3)).toEqual([
        'authorize',
        'delete',
        'list releases',
    ])
    observableRemoval = true
    await distribution.discardUnpublishedDraft(release, authorize)
    expect(operations.slice(-3)).toEqual([
        'authorize',
        'delete',
        'list releases',
    ])
    await distribution.discardUnpublishedDraft(release, authorize)
    expect(operations.slice(-2)).toEqual(['list releases', 'list releases'])
})
