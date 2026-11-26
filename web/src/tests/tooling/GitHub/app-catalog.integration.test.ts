import { afterEach, expect, spyOn, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import type { z } from 'zod'
import fixtures from '../../../../../contracts/v1/fixtures.json'
import {
    parseApproval,
    parseCatalog,
} from '../../../../../contracts/v1/index.ts'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { assetNames } from '@/lib/Marketplace/candidateEvidence.ts'
import type {
    catalogPublicationRequest,
    catalogPublicationWork,
} from '@/lib/Marketplace/catalogPublication.ts'
import { sealCandidate } from '../../../../../.github/scripts/ci/app-candidates/evidence.ts'
import { withCandidateBundle } from '../../../../../.github/scripts/release/app-catalog/artifact.ts'
import {
    type CatalogCore,
    openCatalogCore,
    type SigningKeys,
} from '../../../../../.github/scripts/release/app-catalog/catalog-core.ts'
import {
    loadDistributionCatalog,
    publishCatalogQueue,
    refreshDistributionCatalog,
} from '../../../../../.github/scripts/release/app-catalog/publisher.ts'
import {
    candidateBuild,
    candidateEvidenceFixture,
} from './app-candidate-evidence.fixture.ts'

const day = 86_400_000
const sha = (bytes: Buffer | string) =>
    createHash('sha256').update(bytes).digest('hex')
const expires = (now: Date, days: number) =>
    new Date(now.getTime() + days * day)
        .toISOString()
        .replace(/\.\d{3}Z$/u, 'Z')

const processes: CatalogCore[] = []
const directories: string[] = []
afterEach(async () => {
    await Promise.all([
        ...processes.splice(0).map((core) => core.close()),
        ...directories
            .splice(0)
            .map((path) => rm(path, { recursive: true, force: true })),
    ])
})

function nativeCore(keys: SigningKeys) {
    const core = openCatalogCore(keys)
    processes.push(core)
    return core
}

async function expectFailure(operation: Promise<unknown>, message: string) {
    const result = await operation.catch((error: unknown) => error)
    expect(result).toBeInstanceOf(Error)
    expect(result).toHaveProperty('message', expect.stringContaining(message))
}

// Emit the DEFLATE ZIP records used by streamed GitHub uploads.
function deflatedZip(entries: readonly (readonly [string, Buffer])[]) {
    const localRecords: Buffer[] = []
    const directoryRecords: Buffer[] = []
    let fileOffset = 0
    let directorySize = 0
    for (const [name, bytes] of entries) {
        const filename = Buffer.from(name)
        const compressed = deflateRawSync(bytes)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(0x0808, 6) // UTF-8 name and trailing data descriptor.
        local.writeUInt16LE(8, 8) // DEFLATE.
        local.writeUInt16LE(0x21, 12) // DOS date for 1980-01-01.
        local.writeUInt16LE(filename.length, 26)

        const descriptor = Buffer.alloc(16)
        descriptor.writeUInt32LE(0x08074b50, 0)
        descriptor.writeUInt32LE(Bun.hash.crc32(bytes), 4)
        descriptor.writeUInt32LE(compressed.length, 8)
        descriptor.writeUInt32LE(bytes.length, 12)

        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50, 0)
        directory.writeUInt16LE(0x0314, 4) // ZIP 2.0, made on UNIX.
        local.copy(directory, 6, 4, 14) // Version, flags, compression and time.
        descriptor.copy(directory, 16, 4) // CRC and sizes.
        directory.writeUInt16LE(filename.length, 28)
        directory.writeUInt32LE(0o100644 * 65536, 38)
        directory.writeUInt32LE(fileOffset, 42)

        localRecords.push(local, filename, compressed, descriptor)
        directoryRecords.push(directory, filename)
        fileOffset +=
            local.length +
            filename.length +
            compressed.length +
            descriptor.length
        directorySize += directory.length + filename.length
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(directorySize, 12)
    end.writeUInt32LE(fileOffset, 16)
    return Buffer.concat([...localRecords, ...directoryRecords, end])
}

test('publisher verifies the admitted GitHub ZIP and exact unpacked approved bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'app-catalog-candidate-'))
    directories.push(directory)
    const trustedBuild = {
        ...candidateBuild,
        repositoryId: pipeline.repositoryId,
        workflowPath: pipeline.builder,
    }
    const fixture = await candidateEvidenceFixture(
        directory,
        'candidate',
        trustedBuild,
    )
    const candidate = await sealCandidate(fixture.options)
    const approval = parseApproval({ ...fixtures.records.approval, candidate })
    const names = await readdir(fixture.outputDirectory)
    const bytes = deflatedZip(
        await Promise.all(
            names
                .toSorted()
                .map(
                    async (name) =>
                        [
                            name,
                            await readFile(join(fixture.outputDirectory, name)),
                        ] as const,
                ),
        ),
    )
    const bundle = {
        id: '8700',
        sha256: sha(bytes),
        sizeBytes: bytes.length,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const artifactUrl = 'https://fixture.blob.core.windows.net/data'
    const repo = { id: Number(pipeline.repositoryId) }
    const runId = Number(trustedBuild.runId)
    const token = 'catalog-fixture-credential'
    const now = new Date().toISOString()
    let corrupt = false
    const simulateFetch: typeof fetch = Object.assign(
        async (...[input, init]: Parameters<typeof fetch>) => {
            const url = new URL(String(input))
            const headers = new Headers(init?.headers)
            if (url.href === artifactUrl) {
                expect(headers.get('authorization')).toBeNull()
                const data = Buffer.from(bytes)
                if (corrupt) data[0] ^= 0xff
                return new Response(Uint8Array.from(data))
            }
            expect(url.origin).toBe('https://api.github.com')
            expect(headers.get('authorization')).toBe('Bearer ' + token)
            if (url.pathname.endsWith(`/runs/${runId}/attempts/1`))
                return Response.json({
                    id: runId,
                    workflow_id: Number(pipeline.workflowId),
                    run_attempt: 1,
                    path: pipeline.workflow,
                    head_branch: pipeline.branch,
                    head_sha: trustedBuild.workflowCommit,
                    event: 'workflow_dispatch',
                    display_title: 'Marketplace submission fixture',
                    status: 'completed',
                    conclusion: 'success',
                    created_at: now,
                    updated_at: now,
                    repository: repo,
                    head_repository: repo,
                })
            if (url.pathname.endsWith('/artifacts/' + bundle.id))
                return Response.json({
                    id: Number(bundle.id),
                    name: `fixture-${runId}-1-bundle`,
                    size_in_bytes: bundle.sizeBytes,
                    digest: 'sha256:' + bundle.sha256,
                    expired: false,
                    expires_at: bundle.expiresAt,
                    workflow_run: {
                        id: runId,
                        repository_id: repo.id,
                        head_repository_id: repo.id,
                        head_branch: pipeline.branch,
                        head_sha: trustedBuild.workflowCommit,
                    },
                })
            if (url.pathname.endsWith(`/artifacts/${bundle.id}/zip`))
                return new Response(null, {
                    status: 302,
                    headers: { location: artifactUrl },
                })
            throw new Error('Unexpected candidate network request')
        },
        { preconnect: fetch.preconnect },
    )
    const fetcher = spyOn(globalThis, 'fetch').mockImplementation(simulateFetch)
    try {
        const handoff = { approval, bundle, evidence: bundle }
        const candidateFiles = await readdir(directory)
        const count = await withCandidateBundle(
            handoff,
            token,
            directory,
            async (files) => {
                await Promise.all(
                    [...files].map(async ([name, local]) => {
                        expect(await readFile(local)).toEqual(
                            await readFile(join(fixture.outputDirectory, name)),
                        )
                    }),
                )
                return files.size
            },
        )
        expect(count).toBe(6)
        expect((await readdir(directory)).toSorted()).toEqual(
            candidateFiles.toSorted(),
        )

        corrupt = true
        await expect(
            withCandidateBundle(handoff, token, directory, async () => {
                throw new Error('A changed ZIP must not reach the publisher')
            }),
        ).rejects.toThrow('differs from the approved artifact')
        expect((await readdir(directory)).toSorted()).toEqual(
            candidateFiles.toSorted(),
        )
    } finally {
        fetcher.mockRestore()
    }
})

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
        id: sha(canonicalBytes(object)),
        object,
        publicKey,
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

// These generated TUF fixtures use only ASCII object keys and strings.
function canonicalBytes(signed: object) {
    return Buffer.from(
        JSON.stringify(signed, (_key, value: unknown) =>
            value && typeof value === 'object' && !Array.isArray(value)
                ? Object.fromEntries(
                      Object.entries(value).toSorted(([left], [right]) =>
                          left < right ? -1 : Number(left > right),
                      ),
                  )
                : value,
        ),
    )
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
    const signed = {
        _type: 'root',
        version,
        spec_version: '1.0.0',
        expires: expires(now, 365),
        consistent_snapshot: true,
        roles,
        keys,
    }
    const bytes = canonicalBytes(signed)
    const signatures = signers.map(({ id, pem }) => ({
        keyid: id,
        sig: sign(null, bytes, pem).toString('hex'),
    }))
    return Buffer.from(JSON.stringify({ signed, signatures }))
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
    const core = nativeCore(online(c))
    const files = new Map(await core.bootstrap(root, now))
    return { c, root, files, core }
}

type FileLink = { hashes: { sha256: string }; length: number }
type RoleLink = FileLink & { version: number }

function readRole(files: ReadonlyMap<string, Buffer>, path: string) {
    return JSON.parse(files.get(path)!.toString()) as {
        signed: {
            meta?: Record<string, RoleLink>
            targets?: Record<string, FileLink>
        }
        signatures: { keyid: string; sig: string }[]
    }
}

function inspectCatalog(files: ReadonlyMap<string, Buffer>) {
    const timestampPath = 'metadata/timestamp.json'
    const timestamp = readRole(files, timestampPath)
    const snapshotLink = timestamp.signed.meta!['snapshot.json']!
    const snapshotPath = 'metadata/' + snapshotLink.version + '.snapshot.json'
    const snapshot = readRole(files, snapshotPath)
    const targetsLink = snapshot.signed.meta!['targets.json']!
    const targetsPath = 'metadata/' + targetsLink.version + '.targets.json'
    const targets = readRole(files, targetsPath)
    const catalogLink = targets.signed.targets!['catalog.json']!
    const catalogPath = 'targets/' + catalogLink.hashes.sha256 + '.catalog.json'
    const catalog = parseCatalog(JSON.parse(files.get(catalogPath)!.toString()))
    return {
        catalog,
        timestamp,
        snapshot,
        targets,
        timestampPath,
        links: [
            [snapshotPath, snapshotLink],
            [targetsPath, targetsLink],
            [catalogPath, catalogLink],
        ] as const,
    }
}

test('Rust metadata verifies with independent Ed25519 checks and consistent target hashes', async () => {
    const { c, root, files, core } = await repository()
    const state = await core.read(reader(files), root)
    const bytes = Buffer.from('fixture icon bytes')
    const digest = sha(bytes)
    const iconPath = 'assets/' + digest + '.png'
    const next = parseCatalog({
        ...state.catalog,
        revision: 2,
        releases: [
            {
                ...fixtures.records.release,
                icon: {
                    format: 'png',
                    sha256: digest,
                    sizeBytes: bytes.length,
                },
                packages: fixtures.targets.map(({ target, ...artifact }) => ({
                    ...artifact,
                    manifest: { ...fixtures.manifest, target },
                })),
            },
        ],
    })
    const updated = await core.update(state, next, {
        icons: new Map([[iconPath, bytes]]),
    })
    for (const [path, contents] of updated) files.set(path, contents)
    const { timestamp, snapshot, targets, links } = inspectCatalog(files)
    const roles = [
        [timestamp, c.timestamp[0]!],
        [snapshot, c.snapshot[0]!],
        [targets, c.targets[0]!],
    ] as const
    for (const [{ signed, signatures }, { id, publicKey }] of roles) {
        expect(signatures).toHaveLength(1)
        expect(signatures[0]!.keyid).toBe(id)
        expect(
            verify(
                null,
                canonicalBytes(signed),
                publicKey,
                Buffer.from(signatures[0]!.sig, 'hex'),
            ),
        ).toBe(true)
    }
    const icon = targets.signed.targets![iconPath]!
    const consistentIconPath =
        'targets/assets/' + digest + '.' + digest + '.png'
    for (const [path, link] of [
        ...links,
        [consistentIconPath, icon] as const,
    ]) {
        expect(files.get(path)).toHaveLength(link.length)
        expect(sha(files.get(path)!)).toBe(link.hashes.sha256)
    }
    expect(files.get(consistentIconPath)).toEqual(bytes)
    expect((await core.read(reader(files), root)).catalog).toEqual(next)
})

test('binds update checkpoints to the current catalog worker', async () => {
    const { c, core, files, root } = await repository()
    const other = nativeCore(online(c))
    const read = reader(files)
    const current = await core.read(read, root)
    const foreign = await other.read(read, root)
    await expectFailure(
        core.update(foreign, undefined),
        'Stale or foreign trusted catalog state',
    )
    const later = await core.read(read, root)
    await expectFailure(
        core.update(current, undefined),
        'Stale or foreign trusted catalog state',
    )
    expect((await core.update(later, undefined)).size).toBe(0)
})
type Work = z.output<typeof catalogPublicationWork>
type Request = z.output<typeof catalogPublicationRequest>
type PublisherOptions = Parameters<typeof publishCatalogQueue>[0]

async function publicationFixture(
    versions: string[],
    { createdAt = new Date(), wrongKey = false } = {},
) {
    const { root, files, c, core } = await repository(createdAt)
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
        readOnce: false,
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
            if (faults.readOnce) {
                faults.readOnce = false
                throw new Error('simulated distribution read failure')
            }
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
                const state = storedState()
                const observed = publisherReads.get(currentHead)
                for (const path of [
                    state.timestampPath,
                    ...state.links.map(([linkedPath]) => linkedPath),
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
                expect(catalog().revocations).toContainEqual(work.revocation!)
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
    const storedState = () => inspectCatalog(commits.get(currentHead)!)
    const catalog = () => storedState().catalog
    const options: PublisherOptions = {
        root,
        core: wrongKey
            ? nativeCore({ ...online(c), targets: c.snapshot[0]!.pem })
            : core,
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
    const catalog = fixture.catalog()
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
    await expectFailure(publishCatalogQueue(fixture.options), 'lost receipt')
    fixture.faults.receipt = false
    fixture.nextRun()
    await publishCatalogQueue(fixture.options)
    expect(fixture.catalog().revision).toBe(2)
    expect(
        fixture.events.filter((entry) => !entry.startsWith('authorized:')),
    ).toEqual(['release:1.0.0', 'promoted', 'verified:1.0.0', 'recorded:1.0.0'])
})

test('withholds the receipt when readback of the promoted catalog is corrupt', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.corruptReadback = true
    await expectFailure(
        publishCatalogQueue(fixture.options),
        'Target bytes differ',
    )
    expect(fixture.events).toContain('promoted')
    expect(fixture.events).not.toContain('recorded:1.0.0')
    expect(fixture.approvals[0]!.publication).toBeNull()
})

test('continues with the next approval when a distribution read fails', async () => {
    const fixture = await publicationFixture(['1.0.0', '2.0.0'])
    fixture.faults.readOnce = true
    await expectFailure(
        publishCatalogQueue(fixture.options),
        'Catalog file source failed',
    )
    expect(fixture.deferrals).toEqual([fixture.approvals[0]!.revision])
    expect(fixture.catalog().releases.map(({ version }) => version)).toEqual([
        '2.0.0',
    ])
    expect(fixture.events).toContain('recorded:2.0.0')
})

test.each([
    {
        name: 'another approval',
        substitute: (_work: Work, other: Work) => other.approval,
    },
    {
        name: 'another approval revision',
        substitute: (work: Work) => ({
            ...work.approval,
            revision: work.approval.revision + 1,
        }),
    },
])(
    'defers queued work when the Marketplace returns $name',
    async ({ substitute }) => {
        const fixture = await publicationFixture(['1.0.0', '2.0.0'])
        const [queued, other] = fixture.approvals
        if (!queued || !other) throw new Error('Expected two approvals')
        const marketplace = fixture.options.marketplace as (
            input: Request,
        ) => Promise<unknown>
        fixture.options.marketplace = (async (input: Request) =>
            input.operation === 'get' &&
            input.submissionId === queued.approval.id
                ? {
                      ...queued,
                      approval: substitute(queued, other),
                      revision: queued.revision + 5,
                  }
                : marketplace(input)) as PublisherOptions['marketplace']
        await expectFailure(
            publishCatalogQueue(fixture.options),
            'Marketplace returned a different approval',
        )
        // The answer is not authorized or released, and its revision is not trusted.
        expect(fixture.deferrals).toEqual([queued.revision])
        expect(
            fixture.events.filter((entry) => entry.endsWith(':1.0.0')),
        ).toEqual([])
        expect(
            fixture.catalog().releases.map(({ version }) => version),
        ).toEqual(['2.0.0'])
    },
)

test('publisher refresh atomically rotates an expired installed root before ordinary reads resume', async () => {
    const fixture = await publicationFixture([], {
        createdAt: new Date(Date.now() - 366 * day),
    })
    const { root, distribution } = fixture.options
    const replacement = credentials()
    const nextRoot = rootBytes(replacement, new Date(), 2, [
        ...fixture.rootSigners,
        ...replacement.root,
    ])
    const core = nativeCore(online(replacement))
    await expectFailure(
        loadDistributionCatalog(
            core,
            distribution,
            root,
            await distribution.head(),
        ),
        'Expired root',
    )
    await refreshDistributionCatalog(core, distribution, root, nextRoot)
    expect(fixture.events).toEqual(['promoted'])
    expect(fixture.catalog().revision).toBe(1)
})

test('signs a withdrawal of an unlisted immutable release even when its CDN and another queue item fail', async () => {
    const fixture = await publicationFixture(['2.0.0', '1.0.0'])
    fixture.faults.bundleVersion = '2.0.0'
    fixture.faults.promotion = true
    await expectFailure(
        publishCatalogQueue(fixture.options),
        '2 catalog queue items failed',
    )
    expect(fixture.catalog().releases).toEqual([])
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
    await expectFailure(
        publishCatalogQueue(fixture.options),
        'retained bundle is invalid',
    )
    expect(fixture.catalog().revocations).toEqual([stopped.revocation])
    expect(fixture.events).toContain('confirmed:1.0.0')
})

test('verifies public bytes before recovering an approved release that is absent from the catalog', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.promotion = true
    await expectFailure(
        publishCatalogQueue(fixture.options),
        'stale branch head',
    )
    fixture.faults.promotion = false
    fixture.faults.verification = true
    fixture.nextRun()
    await expectFailure(
        publishCatalogQueue(fixture.options),
        'Public release asset unavailable',
    )
    expect(fixture.catalog().releases).toEqual([])
    fixture.faults.verification = false
    await publishCatalogQueue(fixture.options)
    expect(
        fixture.events.filter((entry) => !entry.startsWith('authorized:')),
    ).toEqual(['release:1.0.0', 'verified:1.0.0', 'promoted', 'recorded:1.0.0'])
})

test('revokes a signed release after a lost receipt when its public package cannot be verified', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.receipt = true
    await expectFailure(publishCatalogQueue(fixture.options), 'lost receipt')
    const stopped = fixture.approvals[0]!
    const { appId, version } = stopped.approval.candidate.release
    expect(fixture.catalog().releases).toContainEqual(
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
    const current = fixture.catalog()
    expect(current.releases).toEqual([])
    expect(current.revocations).toEqual([stopped.revocation])
    expect(fixture.events).toContain('confirmed:1.0.0')
})

test('rejects a wrong catalog signing key before uploading any immutable release', async () => {
    const fixture = await publicationFixture(['1.0.0'], { wrongKey: true })
    await expectFailure(publishCatalogQueue(fixture.options), 'authorized')
    expect(fixture.events).toEqual([])
    expect(fixture.catalog().revision).toBe(1)
})

test('cleans a stopped draft before releasing the unpublished version reservation', async () => {
    const fixture = await publicationFixture(['1.0.0'])
    fixture.faults.upload = true
    await expectFailure(
        publishCatalogQueue(fixture.options),
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
    expect(fixture.catalog().revision).toBe(1)
})
