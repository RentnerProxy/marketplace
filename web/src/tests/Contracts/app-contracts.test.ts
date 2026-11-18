import { describe, expect, test } from 'bun:test'
import fixtures from '../../../../contracts/v1/fixtures.json'
import {
    catalogIconPath,
    catalogIconTarget,
    checkApprovalBinding,
    checkManifestCompatibility,
    checkPublicationBinding,
    contractVersion,
    ContractError,
    packageDownloadUrl,
    packageReleaseAssets,
    parseAppManifest,
    parseCandidate,
    parseCatalog,
} from '../../../../contracts/v1/index.ts'

function documents(profile = fixtures.profiles[0]) {
    const manifest = {
        ...structuredClone(fixtures.manifest),
        id: 'rentnerproxy.' + profile.profile,
        display: { ...fixtures.manifest.display, name: profile.name },
        providers: [profile.profile],
        capabilities: profile.capabilities,
        requires: {
            ...fixtures.manifest.requires,
            engineCapabilities: profile.engineCapabilities,
        },
    }
    const release = {
        ...fixtures.records.release,
        appId: manifest.id,
        packages: fixtures.targets.map(({ target, ...artifact }) => ({
            ...artifact,
            manifest: { ...structuredClone(manifest), target },
        })),
    }
    const candidate = { ...fixtures.records.candidate, release }
    return {
        manifest: structuredClone(manifest),
        environment: structuredClone(fixtures.environment),
        candidate: structuredClone(candidate),
        approval: structuredClone({ ...fixtures.records.approval, candidate }),
        receipt: structuredClone({ ...fixtures.records.receipt, release }),
        catalog: structuredClone({
            ...fixtures.records.catalog,
            releases: [release],
        }),
    }
}

function member(document: object, path: string) {
    const parts = path.slice(1).split('/')
    const key = parts.pop()!
    const holder = parts.reduce<Record<string, unknown>>(
        (value, name) => value[name] as Record<string, unknown>,
        document as Record<string, unknown>,
    )
    return { holder, key }
}

function applyMutation(
    docs: object,
    fixture: { path: string; remove?: boolean; copyFrom?: string; value?: unknown },
) {
    const { holder, key } = member(docs, fixture.path)
    if (fixture.remove) {
        if (Array.isArray(holder)) holder.splice(Number(key), 1)
        else delete holder[key]
    } else if (fixture.copyFrom) {
        const source = member(docs, fixture.copyFrom)
        holder[key] = structuredClone(source.holder[source.key])
    } else {
        holder[key] = structuredClone(fixture.value)
    }
}

describe('stable v1 app contract', () => {
    test('uses the stable contract version', () => {
        expect(contractVersion).toBe('1.0.0')
    })

    for (const profile of fixtures.profiles) {
        test('publishes ' + profile.profile + ' packages on both architectures', () => {
            const docs = documents(profile)
            const approved = checkApprovalBinding(docs.candidate, docs.approval)
            const { release } = checkPublicationBinding(
                docs.approval,
                docs.receipt,
                docs.catalog,
            )
            expect(release).toEqual(approved)
            for (const { target } of fixtures.targets) {
                const artifact = release.packages.find(
                    ({ manifest }) => manifest.target === target,
                )!
                const manifest = checkManifestCompatibility(artifact.manifest, {
                    ...docs.environment,
                    target,
                    engineCapabilities: profile.engineCapabilities,
                })
                expect(manifest.id).toBe(release.appId)
                expect<string[]>(manifest.providers).toEqual([profile.profile])
                expect<string>(manifest.target).toBe(target)
            }
        })
    }

    test('resolves a validated catalog without a Marketplace session', () => {
        const docs = documents()
        const release = checkApprovalBinding(docs.candidate, docs.approval)
        const catalog = parseCatalog(docs.catalog)
        expect(
            checkPublicationBinding(docs.approval, docs.receipt, docs.catalog)
                .release,
        ).toEqual(release)
        const selected = catalog.releases[0]
        const arm64 = selected.packages.find(
            ({ manifest }) => manifest.target === 'linux-arm64',
        )!
        expect(packageDownloadUrl(arm64)).toBe(fixtures.published.downloadUrl)
        expect(catalogIconPath(selected.icon!)).toBe(
            fixtures.published.iconPath,
        )
        expect(arm64.archive.sha256).toBe(fixtures.published.archiveSha256)
        expect(arm64.archive.sizeBytes).toBe(
            fixtures.published.archiveSizeBytes,
        )
        expect(arm64.manifestSha256).toBe(fixtures.published.manifestSha256)
        expect(packageReleaseAssets(arm64)).toEqual({
            archive: {
                url: fixtures.published.downloadUrl,
                sha256: fixtures.published.archiveSha256,
                sizeBytes: fixtures.published.archiveSizeBytes,
            },
            manifestSha256: fixtures.published.manifestSha256,
            sbom: fixtures.published.sbom,
            provenance: fixtures.published.provenance,
        })
        expect(catalogIconTarget(selected.icon!)).toEqual({
            path: fixtures.published.iconPath,
            sha256: fixtures.published.iconSha256,
            sizeBytes: fixtures.published.iconSizeBytes,
        })
        expect(catalog.releases.some(({ version }) => version === '0.0.9')).toBe(
            false,
        )
    })

    test('reordering object keys preserves an approval', () => {
        const { candidate, approval } = documents()
        const reordered = Object.fromEntries(
            Object.entries(candidate).toReversed(),
        )
        expect(checkApprovalBinding(reordered, approval).appId).toBe(
            fixtures.manifest.id,
        )
    })

    for (const fixture of fixtures.cases) {
        test(fixture.name, () => {
            const docs = documents()
            applyMutation(docs, fixture)
            for (const mutation of fixture.also ?? []) applyMutation(docs, mutation)
            const checks: Record<string, () => unknown> = {
                manifest: () => parseAppManifest(docs.manifest),
                compatibility: () =>
                    checkManifestCompatibility(docs.manifest, docs.environment),
                candidate: () => parseCandidate(docs.candidate),
                approval: () =>
                    checkApprovalBinding(docs.candidate, docs.approval),
                publication: () =>
                    checkPublicationBinding(
                        docs.approval,
                        docs.receipt,
                        docs.catalog,
                    ),
                catalog: () => parseCatalog(docs.catalog),
            }
            let code: string | undefined
            try {
                checks[fixture.check]()
            } catch (error: unknown) {
                if (!(error instanceof ContractError)) throw error
                code = error.code
            }
            expect(code).toBe(fixture.error)
        })
    }
})
