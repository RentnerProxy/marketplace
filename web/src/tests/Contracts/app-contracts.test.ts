import { describe, expect, test } from 'bun:test'
import fixtures from '../../../../contracts/v1/fixtures.json'
import {
    catalogIconPath,
    checkApprovalBinding,
    checkPublicationBinding,
    ContractError,
    packageDownloadUrl,
    parseAppManifest,
    parseCandidate,
    parseCatalog,
} from '../../../../contracts/v1/validation.ts'

function documents() {
    const release = {
        ...fixtures.records.release,
        packages: fixtures.targets.map(({ target, ...artifact }) => ({
            ...artifact,
            manifest: { ...structuredClone(fixtures.manifest), target },
        })),
    }
    const candidate = { ...fixtures.records.candidate, release }
    return {
        manifest: structuredClone(fixtures.manifest),
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

describe('preview app contract', () => {
    for (const {
        profile,
        name,
        capabilities,
        engineCapabilities,
    } of fixtures.profiles) {
        test('accepts ' + profile + ' manifests on both architectures', () => {
            for (const { target } of fixtures.targets) {
                const manifest = parseAppManifest({
                    ...fixtures.manifest,
                    id: 'rentnerproxy.' + profile,
                    target,
                    display: { ...fixtures.manifest.display, name },
                    providers: [profile],
                    capabilities,
                    requires: {
                        ...fixtures.manifest.requires,
                        engineCapabilities,
                    },
                })
                expect<string[]>(manifest.providers).toEqual([profile])
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

    test('a new source commit needs approval even when internally consistent', () => {
        const { candidate, approval } = documents()
        const source = { ...candidate.source, commit: 'd'.repeat(40) }
        candidate.source = source
        candidate.release.source = source
        for (const { manifest } of candidate.release.packages)
            manifest.source = source
        expect(() => checkApprovalBinding(candidate, approval)).toThrow(
            'Candidate differs',
        )
    })

    for (const fixture of fixtures.cases) {
        test(fixture.name, () => {
            const docs = documents()
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
            const checks: Record<string, () => unknown> = {
                manifest: () => parseAppManifest(docs.manifest),
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
