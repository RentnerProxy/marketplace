import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Metadata, MetadataKind, Signature } from '@tufjs/models'
import { BaseFetcher, Updater } from 'tuf-js'
import { DownloadHTTPError } from 'tuf-js/dist/error.js'
import type { z } from 'zod'
import fixtures from '../../../../../contracts/v1/fixtures.json'
import {
    parseApproval,
    parseCatalog,
} from '../../../../../contracts/v1/index.ts'
import { assetNames } from '@/lib/Marketplace/candidateEvidence.ts'
import type {
    catalogPublicationRequest,
    catalogPublicationWork,
} from '@/lib/Marketplace/catalogPublication.ts'
import {
    catalogBootstrap,
    catalogUpdate,
    readTrustedCatalog,
} from '../../../../../.github/scripts/release/app-catalog/tuf.ts'
import {
    publishCatalogQueue,
    refreshDistributionCatalog,
} from '../../../../../.github/scripts/release/app-catalog/publisher.ts'

const day = 86_400_000
const sha = (bytes: Buffer | string) =>
    createHash('sha256').update(bytes).digest('hex')
const expires = (now: Date, days: number) =>
    new Date(now.getTime() + days * day)
        .toISOString()
        .replace(/\.\d{3}Z$/u, 'Z')

function key() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const raw = Buffer.from(
        publicKey.export({ format: 'jwk' }).x!,
        'base64url',
    ).toString('hex')
    const object = {
        keytype: 'ed25519',
        keyval: { public: raw },
        scheme: 'ed25519',
    }
    return {
        id: sha(JSON.stringify(object)),
        object,
        pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }
}

function credentials() {
    return {
        root: [key(), key()],
        targets: [key()],
        snapshot: [key()],
        timestamp: [key()],
    }
}
function rootBytes(
    c: ReturnType<typeof credentials>,
    now: Date,
    version = 1,
    signers = c.root,
) {
    const roles = Object.fromEntries(
        Object.entries(c).map(([role, keys]) => [
            role,
            { keyids: keys.map((k) => k.id), threshold: keys.length },
        ]),
    )
    const keys = Object.fromEntries(
        Object.values(c)
            .flat()
            .map((k) => [k.id, k.object]),
    )
    const md = Metadata.fromJSON(MetadataKind.Root, {
        signed: {
            _type: 'root',
            version,
            spec_version: '1.0.0',
            expires: expires(now, 365),
            consistent_snapshot: true,
            roles,
            keys,
        },
        signatures: [],
    })
    for (const k of signers)
        md.sign(
            (bytes) =>
                new Signature({
                    keyID: k.id,
                    sig: sign(null, bytes, k.pem).toString('hex'),
                }),
        )
    return Buffer.from(JSON.stringify(md.toJSON()))
}
function online(c: ReturnType<typeof credentials>) {
    return {
        targets: c.targets[0].pem,
        snapshot: c.snapshot[0].pem,
        timestamp: c.timestamp[0].pem,
    }
}
function reader(files: ReadonlyMap<string, Buffer>) {
    return (path: string) => Promise.resolve(files.get(path) ?? null)
}
async function repository(now = new Date()) {
    const c = credentials()
    const root = rootBytes(c, now)
    const files = new Map(await catalogBootstrap(root, online(c), now))
    const state = await readTrustedCatalog(reader(files), root, { now })
    return { c, root, files, state, now }
}
function withIcon() {
    const bytes = Buffer.from('fixture icon bytes')
    const digest = sha(bytes)
    const icon = { format: 'png', sha256: digest, sizeBytes: bytes.length }
    const release = {
        ...fixtures.records.release,
        icon,
        packages: fixtures.targets.map(({ target, ...artifact }) => ({
            ...artifact,
            manifest: { ...fixtures.manifest, target },
        })),
    }
    return {
        next: parseCatalog({
            ...fixtures.records.catalog,
            revision: 2,
            releases: [release],
        }),
        path: 'assets/' + digest + '.png',
        bytes,
    }
}

test('preserves consistent snapshots and verifies the signed catalog and icon bytes', async () => {
    const { c, root, files, state, now } = await repository()
    const { next, path, bytes } = withIcon()
    expect(
        (await catalogUpdate(state, state.catalog, online(c), { now })).size,
    ).toBe(0)
    await expect(
        catalogUpdate(state, next, online(c), { now }),
    ).rejects.toThrow('Missing approved icon')
    await expect(
        catalogUpdate(state, next, online(c), {
            icons: new Map([[path, Buffer.from('bad')]]),
        }),
    ).rejects.toThrow('icon bytes')
    const changes = await catalogUpdate(state, next, online(c), {
        icons: new Map([[path, bytes]]),
        now,
    })
    const iconPath = 'targets/assets/' + sha(bytes) + '.' + sha(bytes) + '.png'
    expect(changes.get(iconPath)).toEqual(bytes)
    expect(changes.has('metadata/2.targets.json')).toBe(true)
    expect(changes.has('metadata/2.snapshot.json')).toBe(true)
    const latest = new Map([...files, ...changes])
    const updated = await readTrustedCatalog(reader(latest), root, {
        previous: state,
        now,
    })
    expect(updated.catalog).toEqual(next)
    await expect(
        readTrustedCatalog(reader(files), root, { previous: updated }),
    ).rejects.toThrow('rollback')
    await expect(
        catalogUpdate(updated, { ...next, revocations: [] }, online(c)),
    ).rejects.toThrow('revision')
    await expect(
        catalogUpdate(
            updated,
            { ...next, revision: 3, releases: [] },
            online(c),
        ),
    ).rejects.toThrow('revocation')
    latest.set(iconPath, Buffer.from(bytes).fill(0))
    await expect(readTrustedCatalog(reader(latest), root)).rejects.toThrow(
        'Target bytes',
    )
    expect(
        (await readTrustedCatalog(reader(files), root)).catalog.revision,
    ).toBe(1)
})

test('accepts sequential offline rotations signed by both thresholds and separates online roles', async () => {
    const { c, root, files, state, now } = await repository()
    const next = credentials()
    await Promise.all(
        [c.root, next.root, [...c.root, next.root[0]]].map(async (signers) => {
            const nextRoot = rootBytes(next, now, 2, signers)
            await expect(
                catalogUpdate(state, state.catalog, online(next), { nextRoot }),
            ).rejects.toThrow()
        }),
    )
    const signers = [...c.root, ...next.root]
    await expect(
        catalogUpdate(state, state.catalog, online(next), {
            nextRoot: rootBytes(next, now, 3, signers),
        }),
    ).rejects.toThrow('Nonsequential')
    const nextRoot = rootBytes(next, now, 2, signers)
    await expect(
        catalogUpdate(
            state,
            state.catalog,
            { ...online(next), timestamp: next.snapshot[0].pem },
            { nextRoot },
        ),
    ).rejects.toThrow('authorized')
    const changes = await catalogUpdate(state, state.catalog, online(next), {
        nextRoot,
    })
    const updated = await readTrustedCatalog(
        reader(new Map([...files, ...changes])),
        root,
        { previous: state },
    )
    expect(updated.metadata.root.signed.version).toBe(2)
    expect(updated.catalogBytes).toEqual(state.catalogBytes)
    expect(
        (
            await catalogUpdate(updated, updated.catalog, online(next), {
                nextRoot,
            })
        ).size,
    ).toBe(0)
    const reused = { ...next, targets: next.timestamp }
    await expect(
        catalogBootstrap(rootBytes(reused, now), online(reused)),
    ).rejects.toThrow('reused')
    const cross = { ...next, targets: c.timestamp }
    await expect(
        catalogUpdate(state, state.catalog, online(cross), {
            nextRoot: rootBytes(cross, now, 2, signers),
        }),
    ).rejects.toThrow('reassigns')
    const changedKey = { ...next.targets[0], id: c.targets[0].id }
    const reusedId = { ...next, targets: [changedKey] }
    await expect(
        catalogUpdate(state, state.catalog, online(reusedId), {
            nextRoot: rootBytes(reusedId, now, 2, signers),
        }),
    ).rejects.toThrow('reuses a key ID')
})

test('refreshes only due roles, repairs expired online metadata and requires a fresh trusted root', async () => {
    const { c, root, files, state, now } = await repository()
    const later = new Date(now.getTime() + day)
    await expect(
        readTrustedCatalog(reader(files), root, { now: later }),
    ).rejects.toThrow('expired timestamp')
    const expired = await readTrustedCatalog(reader(files), root, {
        now: later,
        allowExpiredRoles: true,
    })
    const renewal = await catalogUpdate(expired, state.catalog, online(c), {
        now: later,
    })
    expect([...renewal.keys()]).toEqual(['metadata/timestamp.json'])
    const renewed = await readTrustedCatalog(
        reader(new Map([...files, ...renewal])),
        root,
        { now: later, previous: state },
    )
    expect(renewed.metadata.timestamp.signed.version).toBe(2)
    const months = new Date(now.getTime() + day * 100)
    const updates = await catalogUpdate(state, state.catalog, online(c), {
        now: months,
    })
    const recovered = await readTrustedCatalog(
        reader(new Map([...files, ...updates])),
        root,
        { now: months, previous: state },
    )
    expect(recovered.metadata.targets.signed.version).toBe(2)
    expect(recovered.catalog.revision).toBe(1)
    await expect(
        readTrustedCatalog(reader(files), root, {
            now: new Date(now.getTime() + day * 366),
            allowExpiredRoles: true,
        }),
    ).rejects.toThrow('Expired root')
    await Promise.all(
        ['metadata/1.targets.json', 'metadata/1.snapshot.json'].map(
            async (path) => {
                const bad = new Map(files)
                bad.set(
                    path,
                    Buffer.concat([files.get(path)!, Buffer.from(' ')]),
                )
                await expect(
                    readTrustedCatalog(reader(bad), root, {
                        now: months,
                        allowExpiredRoles: true,
                    }),
                ).rejects.toThrow()
            },
        ),
    )
})

test('recovers expired installed metadata only with a fresh dual-signed sequential root', async () => {
    const { c, root, files, now } = await repository()
    const later = new Date(now.getTime() + 366 * day)
    const rotated = credentials()
    const signers = [...c.root, ...rotated.root]
    const nextRoot = rootBytes(rotated, later, 2, signers)
    const read = reader(files)
    const recovery = { now: later, allowExpiredRoles: true, nextRoot }
    await expect(
        readTrustedCatalog(read, root, { now: later, nextRoot }),
    ).rejects.toThrow('Expired root')
    const invalid = [
        rootBytes(rotated, now, 2, signers),
        rootBytes(rotated, later, 3, signers),
        rootBytes(rotated, later, 2, rotated.root),
        rootBytes(rotated, later, 2, c.root),
        rootBytes({ ...rotated, targets: c.timestamp }, later, 2, signers),
    ]
    const saved = await readTrustedCatalog(read, root, recovery)
    expect(saved.metadata.root.signed.version).toBe(1)
    await Promise.all(
        invalid.map(async (badRoot) => {
            const options = { ...recovery, nextRoot: badRoot }
            await expect(
                readTrustedCatalog(read, root, options),
            ).rejects.toThrow()
            await expect(
                catalogUpdate(saved, saved.catalog, online(rotated), options),
            ).rejects.toThrow()
        }),
    )
    await expect(
        catalogUpdate(saved, saved.catalog, online(c), { now: later }),
    ).rejects.toThrow('Expired root')

    const changes = await catalogUpdate(
        saved,
        saved.catalog,
        online(rotated),
        recovery,
    )
    expect([...changes.keys()].toSorted()).toEqual([
        'metadata/2.root.json',
        'metadata/2.snapshot.json',
        'metadata/2.targets.json',
        'metadata/timestamp.json',
    ])
    const updated = await readTrustedCatalog(
        reader(new Map([...files, ...changes])),
        root,
        { now: later, previous: saved },
    )
    expect(updated.rootBytes).toEqual(nextRoot)
    expect(updated.catalogBytes).toEqual(saved.catalogBytes)
    // Pending credentials must never authenticate files in the installed state.
    const mixed = new Map(files)
    mixed.set(
        'metadata/timestamp.json',
        changes.get('metadata/timestamp.json')!,
    )
    await expect(
        readTrustedCatalog(reader(mixed), root, recovery),
    ).rejects.toThrow('timestamp was signed by 0')
})

test('tuf-js verifies both target paths and rejects cached rollback and frozen metadata', async () => {
    const { c, root, files, state } = await repository()
    const { next, path, bytes } = withIcon()
    const original = new Map(files)
    const changes = await catalogUpdate(state, next, online(c), {
        icons: new Map([[path, bytes]]),
    })
    const cache = await mkdtemp(join(tmpdir(), 'catalog-tuf-'))
    class FixtureFetcher extends BaseFetcher {
        async fetch(url: string) {
            const data = files.get(new URL(url).pathname.slice(1))
            if (!data) throw new DownloadHTTPError('Fixture file absent', 404)
            return new Blob([Uint8Array.from(data)]).stream()
        }
    }
    const client = (metadataDir = cache) =>
        new Updater({
            metadataDir,
            metadataBaseUrl: 'https://fixture.invalid/metadata/',
            targetBaseUrl: 'https://fixture.invalid/targets/',
            fetcher: new FixtureFetcher(),
        })
    try {
        await writeFile(join(cache, 'root.json'), root)
        await client().refresh()
        for (const [name, value] of changes) files.set(name, value)
        const current = client()
        await current.refresh()
        await Promise.all(
            (
                [
                    ['catalog.json', Buffer.from(JSON.stringify(next))],
                    [path, bytes],
                ] as const
            ).map(async ([target, expected], index) => {
                const targetInfo = await current.getTargetInfo(target)
                expect(
                    await readFile(
                        await current.downloadTarget(
                            targetInfo!,
                            join(cache, 'download-' + index),
                        ),
                    ),
                ).toEqual(expected)
            }),
        )
        files.set(
            'metadata/timestamp.json',
            original.get('metadata/timestamp.json')!,
        )
        await expect(client().refresh()).rejects.toThrow(
            'less than current version',
        )
        const frozen = await catalogBootstrap(
            root,
            online(c),
            new Date(Date.now() - day * 2),
        )
        const freshCache = join(cache, 'fresh')
        await mkdir(freshCache)
        await writeFile(join(freshCache, 'root.json'), root)
        for (const [name, value] of frozen) files.set(name, value)
        await expect(client(freshCache).refresh()).rejects.toThrow(
            'timestamp.json is expired',
        )
    } finally {
        await rm(cache, { recursive: true, force: true })
    }
})

type Work = z.output<typeof catalogPublicationWork>
type Request = z.output<typeof catalogPublicationRequest>
type PublisherOptions = Parameters<typeof publishCatalogQueue>[0]

async function publicationFixture(versions: string[], createdAt = new Date()) {
    const { root, files, c } = await repository(createdAt)
    const keys = online(c)
    const approvals = versions.map((version, index): Work => {
        const artifacts = {
            id: String(100 + index),
            sha256: sha(version),
            sizeBytes: 10,
            expiresAt: new Date(Date.now() + day).toISOString(),
        }
        const { appId, source, publisher } = fixtures.records.release
        const release = {
            appId,
            source,
            publisher,
            version,
            packages: fixtures.targets.map(({ target, ...artifact }) => ({
                ...artifact,
                manifest: { ...fixtures.manifest, version, target },
            })),
        }
        return {
            approval: parseApproval({
                ...fixtures.records.approval,
                id: crypto.randomUUID(),
                candidate: {
                    ...fixtures.records.candidate,
                    id: sha(version),
                    release,
                },
            }),
            bundle: artifacts,
            evidence: artifacts,
            status: 'approved',
            revision: fixtures.records.approval.revision,
            run: null,
            publication: null,
            revocation: null,
        }
    })
    const events: string[] = []
    const publicReleases = new Set<string>()
    const drafts = new Set<string>()
    const deferrals: number[] = []
    const publisherReads = new Map<string, Set<string>>()
    const faults = {
        promotion: false,
        receipt: false,
        bundleVersion: '',
        verification: false,
        corruptReadback: false,
        upload: false,
    }
    let currentRun = {
        ...fixtures.records.receipt.run,
        runId: '5551',
        attempt: 1,
    }
    let currentHead = '1'.repeat(40)
    const commits = new Map([[currentHead, files]])

    const distribution: PublisherOptions['distribution'] = {
        head: async () => currentHead,
        async readAt(head, path) {
            const observed = publisherReads.get(head) ?? new Set<string>()
            observed.add(path)
            publisherReads.set(head, observed)
            const bytes = commits.get(head)?.get(path)
            if (
                faults.corruptReadback &&
                commits.size > 1 &&
                head === currentHead &&
                path.endsWith('.catalog.json') &&
                bytes
            ) {
                return Buffer.from(bytes).fill(0)
            }
            return bytes ? Buffer.from(bytes) : null
        },
        async promote(head, additions, authorize) {
            expect(head).toBe(currentHead)
            await authorize?.()
            if (faults.promotion) throw new Error('simulated stale branch head')
            const next = new Map([...commits.get(head)!, ...additions])
            currentHead = sha(currentHead).slice(0, 40)
            commits.set(currentHead, next)
            events.push('promoted')
            return currentHead
        },
        async ensureRelease(release, bytes, authorize) {
            await authorize()
            expect(bytes.size).toBe(6)
            drafts.add(release.version)
            if (faults.upload) throw new Error('Interrupted draft upload')
            drafts.delete(release.version)
            publicReleases.add(release.version)
            events.push('release:' + release.version)
        },
        async verifyRelease(release) {
            if (faults.verification)
                throw new Error('Public release asset unavailable')
            expect(publicReleases.has(release.version)).toBe(true)
            events.push('verified:' + release.version)
        },
        async inspectRelease(release) {
            if (!publicReleases.has(release.version))
                return drafts.has(release.version) ? 'draft' : 'absent'
            return 'published'
        },
        async discardUnpublishedDraft(release, authorize) {
            await authorize()
            expect(drafts.delete(release.version)).toBe(true)
            events.push('discarded:' + release.version)
        },
    }

    const request = async (input: Request) => {
        if (input.operation === 'queue')
            return {
                items: approvals
                    .filter(
                        (work) =>
                            work.status === 'approved' ||
                            work.status === 'publishing' ||
                            (work.revocation &&
                                !events.includes(
                                    'confirmed:' +
                                        work.approval.candidate.release.version,
                                )),
                    )
                    .map((work) => ({
                        submissionId: work.approval.id,
                        approvalRevision: work.approval.revision,
                        revision: work.revision,
                        run: work.run,
                        kind:
                            work.status === 'approved'
                                ? 'publish'
                                : work.publication
                                  ? 'revoke'
                                  : 'recover',
                    })),
            }
        const work = approvals.find(
            ({ approval }) => approval.id === input.submissionId,
        )!
        const { approval, bundle, evidence } = work
        expect(input.approvalRevision).toBe(approval.revision)
        const { release } = approval.candidate
        switch (input.operation) {
            case 'get':
                return work
            case 'defer':
                expect(input.revision).toBe(work.revision)
                deferrals.push(input.revision)
                return { status: work.status }
            case 'authorizeDraftCleanup':
                expect(work.run?.runId).toBe(input.previousRun.runId)
                expect(work.revocation).not.toBeNull()
                events.push('cleanup:' + release.version)
                return { status: work.status }
            case 'authorize':
                events.push('authorized:' + release.version)
                if (input.previousRun && work.run?.runId !== currentRun.runId)
                    expect(work.run?.runId).toBe(input.previousRun.runId)
                if (work.run?.runId !== currentRun.runId) work.revision++
                work.status = 'publishing'
                work.run = currentRun
                return { approval, bundle, evidence, revision: work.revision }
            case 'published': {
                // Inspect fixture storage independently of calls made by the publisher.
                const state = await storedState()
                const observed = publisherReads.get(currentHead)
                for (const path of [
                    'metadata/timestamp.json',
                    'metadata/' +
                        state.metadata.snapshot.signed.version +
                        '.snapshot.json',
                    'metadata/' +
                        state.metadata.targets.signed.version +
                        '.targets.json',
                    'targets/' + sha(state.catalogBytes) + '.catalog.json',
                ])
                    expect(observed?.has(path)).toBe(true)
                expect(input.catalogRevision).toBe(state.catalog.revision)
                if (faults.receipt) throw new Error('simulated lost receipt')
                expect(publicReleases.has(release.version)).toBe(true)
                expect(state.catalog.releases).toContainEqual(release)
                expect(input.release).toEqual(release)
                expect(work.run?.runId).toBe(
                    input.previousRun?.runId ?? currentRun.runId,
                )
                work.publication = {
                    formatVersion: 1,
                    id: approval.id,
                    approvalId: approval.id,
                    approvalRevision: approval.revision,
                    catalogRevision: input.catalogRevision,
                    publishedAt: input.publishedAt,
                    release: input.release,
                    run: work.run!,
                }
                work.status = 'published'
                events.push('recorded:' + release.version)
                return { status: work.status }
            }
            case 'confirmRevocation':
                expect((await catalog()).revocations).toContainEqual(
                    work.revocation!,
                )
                if (!work.publication)
                    expect(input.previousRun?.runId).toEqual(work.run?.runId)
                work.status = 'revoked'
                events.push('confirmed:' + release.version)
                return { status: work.status }
            case 'neverPromoted':
                expect(drafts.has(release.version)).toBe(false)
                expect(publicReleases.has(release.version)).toBe(false)
                expect(work.run?.runId).toBe(input.previousRun.runId)
                work.run = null
                events.push('reset:' + release.version)
                return { status: work.status }
        }
        throw new Error('Unexpected test Marketplace operation')
    }
    const storedState = () =>
        readTrustedCatalog(reader(commits.get(currentHead)!), root)
    const catalog = async () => (await storedState()).catalog
    const options: PublisherOptions = {
        root,
        keys,
        distribution,
        marketplace: request as PublisherOptions['marketplace'],
        withBundle: async (handoff, use) => {
            const { release } = handoff.approval.candidate
            if (release.version === faults.bundleVersion)
                throw new Error('retained bundle is invalid')
            const paths = release.packages.flatMap(({ manifest }) =>
                Object.values(assetNames(manifest)),
            )
            return use(new Map(paths.map((name) => [name, name])))
        },
    }
    return {
        options,
        events,
        faults,
        deferrals,
        approvals,
        catalog,
        rootSigners: c.root,
        nextRun: () => {
            currentRun = { ...currentRun, runId: '5552' }
        },
    }
}

test('publishes two dual-target approved app versions with catalog readback before recording', async () => {
    const fixture = await publicationFixture(['1.0.0', '2.0.0'])
    await publishCatalogQueue(fixture.options)
    const catalog = await fixture.catalog()
    expect(catalog.revision).toBe(3)
    expect(
        catalog.releases.map(({ packages }) =>
            packages.map(({ manifest }) => manifest.target),
        ),
    ).toEqual([
        ['linux-amd64', 'linux-arm64'],
        ['linux-amd64', 'linux-arm64'],
    ])
    expect(
        fixture.events.filter((entry) => !entry.startsWith('authorized:')),
    ).toEqual([
        'release:1.0.0',
        'promoted',
        'recorded:1.0.0',
        'release:2.0.0',
        'promoted',
        'recorded:2.0.0',
    ])
})

test('reconciles a lost receipt for the old run without replacing bytes or catalog metadata', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.receipt = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'lost receipt',
    )
    fixture.faults.receipt = false
    fixture.nextRun()
    await publishCatalogQueue(fixture.options)
    expect((await fixture.catalog()).revision).toBe(2)
    expect(
        fixture.events.filter((entry) => !entry.startsWith('authorized:')),
    ).toEqual(['release:1.0.0', 'promoted', 'verified:1.0.0', 'recorded:1.0.0'])
})

test('withholds the receipt when readback of the promoted catalog is corrupt', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.corruptReadback = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'Target bytes differ',
    )
    expect(fixture.events).toContain('promoted')
    expect(fixture.events).not.toContain('recorded:1.0.0')
    expect(fixture.approvals[0]!.publication).toBeNull()
})

test('publisher refresh atomically rotates an expired installed root before ordinary reads resume', async () => {
    const fixture = await publicationFixture(
        [],
        new Date(Date.now() - 366 * day),
    )
    const { root, distribution } = fixture.options
    const replacement = credentials()
    const nextRoot = rootBytes(replacement, new Date(), 2, [
        ...fixture.rootSigners,
        ...replacement.root,
    ])
    await expect(fixture.catalog()).rejects.toThrow('Expired root')
    await refreshDistributionCatalog(
        distribution,
        root,
        online(replacement),
        nextRoot,
    )
    expect(fixture.events).toEqual(['promoted'])
    expect((await fixture.catalog()).revision).toBe(1)
})

test('signs a withdrawal of an unlisted immutable release even when its CDN and another queue item fail', async () => {
    const fixture = await publicationFixture(['2.0.0', '1.0.0'])
    fixture.faults.bundleVersion = '2.0.0'
    fixture.faults.promotion = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        '2 catalog queue items failed',
    )
    expect((await fixture.catalog()).releases).toEqual([])
    fixture.faults.promotion = false
    fixture.faults.verification = true
    fixture.nextRun()
    const stopped = fixture.approvals[1]!
    const { appId, version } = stopped.approval.candidate.release
    stopped.status = 'withdrawn'
    stopped.revocation = {
        appId,
        version,
        revokedAt: new Date().toISOString(),
        reason: 'withdrawn',
    }
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'retained bundle is invalid',
    )
    expect((await fixture.catalog()).revocations).toEqual([stopped.revocation])
    expect(fixture.events).toContain('confirmed:1.0.0')
})

test('verifies public bytes before recovering an approved release that is absent from the catalog', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.promotion = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'stale branch head',
    )
    fixture.faults.promotion = false
    fixture.faults.verification = true
    fixture.nextRun()
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'Public release asset unavailable',
    )
    expect((await fixture.catalog()).releases).toEqual([])
    fixture.faults.verification = false
    await publishCatalogQueue(fixture.options)
    expect(
        fixture.events.filter((entry) => !entry.startsWith('authorized:')),
    ).toEqual(['release:1.0.0', 'verified:1.0.0', 'promoted', 'recorded:1.0.0'])
})

test('revokes a signed release after a lost receipt when its public package cannot be verified', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.receipt = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'lost receipt',
    )
    const stopped = fixture.approvals[0]!
    const { appId, version } = stopped.approval.candidate.release
    expect((await fixture.catalog()).releases).toContainEqual(
        stopped.approval.candidate.release,
    )
    expect(stopped.publication).toBeNull()
    stopped.status = 'revoked'
    stopped.revocation = {
        appId,
        version,
        revokedAt: new Date().toISOString(),
        reason: 'security',
    }
    fixture.faults.receipt = false
    fixture.faults.verification = true
    fixture.nextRun()
    await publishCatalogQueue(fixture.options)
    const current = await fixture.catalog()
    expect(current.releases).toEqual([])
    expect(current.revocations).toEqual([stopped.revocation])
    expect(fixture.events).toContain('confirmed:1.0.0')
})

test('rejects a wrong catalog signing key before uploading any immutable release', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.options.keys.targets = fixture.options.keys.snapshot
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'authorized',
    )
    expect(fixture.events).toEqual([])
    expect((await fixture.catalog()).revision).toBe(1)
})

test('cleans a stopped draft before releasing the unpublished version reservation', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.upload = true
    await expect(publishCatalogQueue(fixture.options)).rejects.toThrow(
        'Interrupted draft upload',
    )
    const stopped = fixture.approvals[0]!
    expect(fixture.deferrals).toEqual([stopped.revision])
    fixture.nextRun()
    stopped.status = 'withdrawn'
    stopped.revision++
    const { appId, version } = stopped.approval.candidate.release
    stopped.revocation = {
        appId,
        version,
        revokedAt: new Date().toISOString(),
        reason: 'withdrawn',
    }
    await publishCatalogQueue(fixture.options)
    expect(fixture.events.slice(-3)).toEqual([
        'cleanup:1.0.0',
        'discarded:1.0.0',
        'reset:1.0.0',
    ])
    expect((await fixture.catalog()).revision).toBe(1)
})
