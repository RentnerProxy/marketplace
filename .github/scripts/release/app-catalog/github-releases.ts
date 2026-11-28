import { z } from 'zod'
import {
    packageReleaseAssets,
    parseCatalog,
    type CatalogRelease,
} from '@rentnerproxy/app-contracts'
import { verifyNativeArtifactStream } from '../../../../web/src/lib/Core/native-tool.ts'
import {
    evidenceLimit,
    fileIdentity,
    packageLimit,
} from '../../ci/app-candidates/evidence-files.ts'
import {
    catalogBranch,
    type GitHubHttp,
    oid,
    repositoryPath,
} from './github-http.ts'

const draftBody =
    'App package and evidence managed by RentnerProxy Marketplace.'
const releasePath = `${repositoryPath}/releases`
const releaseAssetHosts = new Set([
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
])
const id = z.number().int().positive()
const releaseRecord = z.object({
    id,
    tag_name: z.string(),
    draft: z.boolean(),
    immutable: z.boolean(),
    prerelease: z.boolean(),
    body: z.string().nullable(),
    target_commitish: z.string(),
})
const assetRecord = z.object({
    id,
    name: z.string(),
    state: z.enum(['uploaded', 'starter']),
    size: z.number().int().nonnegative(),
    digest: z.string().nullish(),
    browser_download_url: z.string().optional(),
})
const tagRecord = z.object({
    ref: z.string(),
    object: z.object({ type: z.enum(['tag', 'commit']), sha: oid }),
})
const immutableSettings = z.object({ enabled: z.literal(true) })

type RemoteRelease = z.infer<typeof releaseRecord>
type RemoteAsset = z.infer<typeof assetRecord>
type Asset = { url: string; sha256: string; sizeBytes: number }

function releaseIdentity(input: CatalogRelease) {
    const {
        releases: [release],
    } = parseCatalog({
        formatVersion: 1,
        revision: 1,
        releases: [input],
        revocations: [],
    })
    if (!release) throw new Error('Missing catalog release')
    const assets = new Map<string, Asset>()
    for (const pkg of release.packages) {
        const { archive, sbom, provenance } = packageReleaseAssets(pkg)
        for (const asset of [archive, sbom, provenance]) {
            const name = asset.url.slice(asset.url.lastIndexOf('/') + 1)
            assets.set(name, asset)
        }
    }
    return {
        tag: `${release.appId}-v${release.version}`,
        prerelease: release.version.includes('-'),
        assets,
    }
}

type ReleaseIdentity = ReturnType<typeof releaseIdentity>

function assertReleaseMode(expected: ReleaseIdentity, remote: RemoteRelease) {
    if (
        remote.tag_name !== expected.tag ||
        remote.prerelease !== expected.prerelease
    )
        throw new Error('GitHub release identity differs from the catalog')
    if (remote.draft) {
        if (
            remote.immutable ||
            remote.body !== draftBody ||
            remote.target_commitish !== catalogBranch
        )
            throw new Error(
                'GitHub release draft belongs to a different publisher',
            )
    } else if (!remote.immutable) {
        throw new Error('Published GitHub release is mutable')
    }
}

function matchAsset(expected: Asset, remote: RemoteAsset, isPublic: boolean) {
    if (
        remote.state !== 'uploaded' ||
        remote.size !== expected.sizeBytes ||
        remote.digest !== `sha256:${expected.sha256}` ||
        (isPublic && remote.browser_download_url !== expected.url)
    ) {
        throw new Error('GitHub release asset differs from the catalog bytes')
    }
}

async function verifyPublicBytes(http: GitHubHttp, expected: Asset) {
    let url = expected.url
    for (let hop = 0; hop <= 3; hop += 1) {
        // eslint-disable-next-line no-await-in-loop -- check each redirect before making the next request
        const response = await http.send(url, { credentials: 'omit' }, 90_000)
        if (response.status === 200) {
            if (!response.body)
                throw new Error('GitHub response is missing its body')
            // eslint-disable-next-line no-await-in-loop -- stream the single final response
            const result = await verifyNativeArtifactStream(
                response.body,
                expected,
            )
            if (result === 'length-exceeded')
                throw new Error('GitHub response exceeds the permitted length')
            if (result !== 'verified')
                throw new Error(
                    'Public GitHub release asset bytes differ from the catalog',
                )
            return
        }
        // eslint-disable-next-line no-await-in-loop -- dispose of each redirect response
        await response.body?.cancel()
        if (![301, 302, 303, 307, 308].includes(response.status))
            throw new Error(
                `Public release asset download returned HTTP ${response.status}`,
            )
        const location = response.headers.get('location')
        if (!location) throw new Error('Missing GitHub release asset redirect')
        const redirect = new URL(location, url)
        if (
            redirect.protocol !== 'https:' ||
            redirect.port ||
            redirect.username ||
            redirect.password ||
            !releaseAssetHosts.has(redirect.hostname)
        )
            throw new Error('Invalid GitHub release asset redirect')
        url = redirect.href
    }
    throw new Error('Too many GitHub release asset redirects')
}

export function githubReleases(
    http: GitHubHttp,
    assertDistributionRepository: () => Promise<void>,
) {
    async function assertImmutableSettings() {
        const settings = await http.request({
            path: `${repositoryPath}/immutable-releases`,
            allowMissing: true,
        })
        if (!immutableSettings.safeParse(settings).success)
            throw new Error(
                'Catalog repository must have immutable releases enabled',
            )
    }

    async function findPublished(expected: ReleaseIdentity) {
        const result = await http.request({
            path: `${releasePath}/tags/${expected.tag}`,
            allowMissing: true,
        })
        if (result === null) return null
        const release = releaseRecord.parse(result)
        assertReleaseMode(expected, release)
        if (release.draft)
            throw new Error('Published GitHub lookup returned a release draft')
        return release
    }

    async function findListedRelease(expected: ReleaseIdentity) {
        let match: RemoteRelease | undefined
        for (let page = 1; page <= 100; page += 1) {
            // eslint-disable-next-line no-await-in-loop -- stop at the first short page
            const results = await http.request({
                path: `${releasePath}?per_page=100&page=${page}`,
            })
            const entries = releaseRecord.array().max(100).parse(results)
            for (const release of entries) {
                if (release.tag_name !== expected.tag) continue
                if (match)
                    throw new Error(
                        'GitHub contains duplicate releases for the catalog tag',
                    )
                match = release
            }
            if (entries.length < 100) return match
        }
        throw new Error('GitHub release pagination limit exceeded')
    }

    async function listAssets(
        expected: ReleaseIdentity,
        release: RemoteRelease,
    ) {
        const result = await http.request({
            path: `${releasePath}/${release.id}/assets?per_page=100`,
        })
        const assets = new Map<string, RemoteAsset>()
        for (const asset of assetRecord
            .array()
            .max(expected.assets.size)
            .parse(result)) {
            const identity = expected.assets.get(asset.name)
            if (!identity || assets.has(asset.name))
                throw new Error(
                    'GitHub release contains an unexpected or duplicate asset',
                )
            if (
                release.draft &&
                asset.state === 'starter' &&
                asset.size === 0 &&
                !asset.digest
            ) {
                assets.set(asset.name, asset)
                continue
            }
            matchAsset(identity, asset, !release.draft)
            assets.set(asset.name, asset)
        }
        return assets
    }

    async function verifyPublishedMetadata(
        expected: ReleaseIdentity,
        published: RemoteRelease,
    ) {
        const ref = tagRecord.parse(
            await http.request({
                path: `${repositoryPath}/git/ref/tags/${expected.tag}`,
            }),
        )
        if (ref.ref !== `refs/tags/${expected.tag}`)
            throw new Error('Unexpected public GitHub tag')
        if (
            (await listAssets(expected, published)).size !==
            expected.assets.size
        )
            throw new Error(
                'Published GitHub release is missing expected assets',
            )
    }

    async function verifyPublished(
        expected: ReleaseIdentity,
        published: RemoteRelease,
    ) {
        await verifyPublishedMetadata(expected, published)
        for (const asset of expected.assets.values()) {
            // eslint-disable-next-line no-await-in-loop -- keep archive downloads bounded in flight
            await verifyPublicBytes(http, asset)
        }
    }

    async function locateRelease(expected: ReleaseIdentity) {
        const release =
            (await findPublished(expected)) ??
            (await findListedRelease(expected))
        if (release) {
            assertReleaseMode(expected, release)
            if (!release.draft) return { status: 'published', release } as const
        }
        const assets = release ? await listAssets(expected, release) : undefined
        const tag = await http.request({
            path: `${repositoryPath}/git/ref/tags/${expected.tag}`,
            allowMissing: true,
        })
        if (tag !== null)
            throw new Error(
                'GitHub has a catalog tag without a verified immutable release',
            )
        if (!release || !assets) return { status: 'absent' } as const
        return { status: 'draft', release, assets } as const
    }

    async function inspectRelease(input: CatalogRelease) {
        const expected = releaseIdentity(input)
        await assertDistributionRepository()
        const state = await locateRelease(expected)
        if (state.status === 'published')
            await verifyPublishedMetadata(expected, state.release)
        return state.status
    }

    async function verifyRelease(input: CatalogRelease) {
        const expected = releaseIdentity(input)
        await assertDistributionRepository()
        const published = await findPublished(expected)
        if (!published)
            throw new Error('Immutable catalog release is not public')
        await verifyPublished(expected, published)
    }

    async function discardUnpublishedDraft(
        input: CatalogRelease,
        authorize: () => Promise<void>,
    ) {
        const expected = releaseIdentity(input)
        await assertDistributionRepository()
        const state = await locateRelease(expected)
        if (state.status === 'absent') return
        if (state.status === 'published')
            throw new Error(
                'Cannot discard an already published catalog release',
            )

        await authorize()
        await http.request({
            method: 'DELETE',
            path: `${releasePath}/${state.release.id}`,
            allowMissing: true,
        })
        if ((await locateRelease(expected)).status !== 'absent')
            throw new Error('Cannot confirm catalog release draft was removed')
    }

    async function ensureRelease(
        input: CatalogRelease,
        files: ReadonlyMap<string, string>,
        authorize: () => Promise<void>,
    ) {
        const expected = releaseIdentity(input)
        if (
            files.size !== expected.assets.size ||
            [...expected.assets.keys()].some((name) => !files.get(name))
        )
            throw new Error(
                'Local release files differ from expected catalog assets',
            )
        await assertDistributionRepository()
        const state = await locateRelease(expected)
        if (state.status === 'published')
            return verifyPublished(expected, state.release)
        await assertImmutableSettings()

        const draft =
            state.status === 'draft'
                ? state.release
                : releaseRecord.parse(
                      await http.request({
                          method: 'POST',
                          path: releasePath,
                          body: {
                              tag_name: expected.tag,
                              target_commitish: catalogBranch,
                              name: expected.tag,
                              body: draftBody,
                              draft: true,
                              prerelease: expected.prerelease,
                              make_latest: 'false',
                          },
                      }),
                  )
        assertReleaseMode(expected, draft)
        if (!draft.draft)
            throw new Error('GitHub did not create a release draft')
        const assets =
            state.status === 'draft'
                ? state.assets
                : await listAssets(expected, draft)
        for (const [name, identity] of expected.assets) {
            const asset = assets.get(name)
            if (asset?.state === 'uploaded') continue
            const path = files.get(name)
            if (!path) throw new Error('Missing local release asset')
            const limit = name.endsWith('.tar.zst')
                ? packageLimit
                : evidenceLimit
            /* eslint-disable no-await-in-loop -- serialize draft writes and bounded file reads */
            await fileIdentity(path, limit, identity)
            if (asset) {
                await http.request({
                    method: 'DELETE',
                    path: `${releasePath}/assets/${asset.id}`,
                })
            }
            const uploaded = assetRecord.parse(
                await http.upload(draft.id, name, Bun.file(path)),
            )
            if (uploaded.name !== name)
                throw new Error('Unexpected uploaded release asset name')
            matchAsset(identity, uploaded, false)
            /* eslint-enable no-await-in-loop */
        }

        const complete = await listAssets(expected, draft)
        if (
            complete.size !== expected.assets.size ||
            [...complete.values()].some((asset) => asset.state !== 'uploaded')
        )
            throw new Error('Draft release is missing expected assets')
        await assertImmutableSettings()
        await authorize()
        const published = releaseRecord.parse(
            await http.request({
                method: 'PATCH',
                path: `${releasePath}/${draft.id}`,
                body: { draft: false, make_latest: 'false' },
            }),
        )
        assertReleaseMode(expected, published)
        if (published.draft || published.id !== draft.id)
            throw new Error('GitHub did not publish the catalog release')
        await verifyRelease(input)
    }

    return {
        discardUnpublishedDraft,
        ensureRelease,
        inspectRelease,
        verifyRelease,
    }
}
