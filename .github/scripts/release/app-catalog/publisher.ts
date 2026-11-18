import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import { parseCatalog, type Catalog } from '../../../../contracts/v1/index.ts'
import type {
    catalogPublicationQueue,
    catalogPublicationWork,
    publicationHandoff,
} from '../../../../web/src/lib/Marketplace/catalogPublication.ts'
import type { createDistribution } from './distribution.ts'
import {
    PublicationResponseError,
    type marketplacePublisher,
} from './marketplace.ts'
import {
    catalogUpdate,
    readTrustedCatalog,
    type TrustedCatalog,
} from './tuf.ts'

type QueueItem = z.output<typeof catalogPublicationQueue>['items'][number]
type Work = z.output<typeof catalogPublicationWork>
type Handoff = z.output<typeof publicationHandoff>
type Distribution = ReturnType<typeof createDistribution>
type Keys = Parameters<typeof catalogUpdate>[2]
type Marketplace = ReturnType<typeof marketplacePublisher>
type Identity = Pick<QueueItem, 'submissionId' | 'approvalRevision'>
type PriorRun = Pick<NonNullable<Work['run']>, 'runId' | 'attempt'>

interface PublisherOptions {
    distribution: Distribution
    marketplace: Marketplace
    root: Buffer
    keys: Keys
    withBundle: <T>(
        handoff: Handoff,
        use: (files: ReadonlyMap<string, string>) => Promise<T>,
    ) => Promise<T>
}

function catalogEntry(
    catalog: Catalog,
    release: Work['approval']['candidate']['release'],
) {
    const matches = (item: { appId: string; version: string }) =>
        item.appId === release.appId && item.version === release.version
    return {
        release: catalog.releases.find(matches),
        revocation: catalog.revocations.find(matches),
    }
}

export async function loadDistributionCatalog(
    distribution: Distribution,
    root: Buffer,
    head: string,
    allowExpiredRoles = false,
    previous?: TrustedCatalog,
) {
    return readTrustedCatalog(
        (path, maxBytes) => distribution.readAt(head, path, maxBytes),
        root,
        { allowExpiredRoles, previous },
    )
}

export async function refreshDistributionCatalog(
    distribution: Distribution,
    root: Buffer,
    keys: Keys,
    nextRoot?: Buffer,
) {
    const head = await distribution.head()
    const trusted = await loadDistributionCatalog(
        distribution,
        root,
        head,
        true,
    )
    const files = await catalogUpdate(trusted, trusted.catalog, keys, {
        nextRoot,
    })
    if (!files.size) return
    const updatedHead = await distribution.promote(head, files)
    await loadDistributionCatalog(
        distribution,
        root,
        updatedHead,
        false,
        trusted,
    )
}

export async function publishCatalogQueue(options: PublisherOptions) {
    const { distribution, marketplace, root, keys } = options
    const { items } = await marketplace({ operation: 'queue' })
    const deadline = Date.now() + 12 * 60_000
    const failures: unknown[] = []
    for (const item of items) {
        // Process from the newest persisted catalog in serial order.
        if (Date.now() >= deadline) break
        try {
            // oxlint-disable-next-line no-await-in-loop
            await processItem(item)
        } catch (error) {
            // A stop or another state transition can win before authorization.
            if (!(
                error instanceof PublicationResponseError &&
                error.status === 409
            ))
                failures.push(error)
        }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
        throw new AggregateError(
            failures,
            `${failures.length} catalog queue items failed`,
        )

    async function processItem(item: QueueItem) {
        const { submissionId, approvalRevision } = item
        const identity = { submissionId, approvalRevision }
        const work = await marketplace({ operation: 'get', ...identity })
        if (
            work.approval.id !== submissionId ||
            work.approval.revision !== approvalRevision
        )
            throw new Error('Marketplace returned a different approval')
        const head = await distribution.head()
        const trusted = await loadDistributionCatalog(distribution, root, head)
        const release = work.approval.candidate.release
        const existing = catalogEntry(trusted.catalog, release)

        if (existing.release && !isDeepStrictEqual(existing.release, release))
            throw new Error(
                'Published app version conflicts with the Marketplace approval',
            )

        if (work.publication) {
            if (work.revocation) await revoke(identity, work, trusted, head)
            return
        }
        const previousRun = work.run
            ? { runId: work.run.runId, attempt: work.run.attempt }
            : undefined
        if (previousRun && existing.release) {
            await distribution.verifyRelease(release)
            await recordPublication(
                identity,
                existing.release,
                trusted,
                head,
                previousRun,
            )
            return
        }
        if (previousRun) {
            if (!(await distribution.hasPublishedRelease(release))) {
                if (existing.revocation)
                    throw new Error(
                        'Signed revocation has no matching immutable release',
                    )
                await marketplace({
                    operation: 'neverPromoted',
                    ...identity,
                    previousRun,
                })
                return
            }
            if (work.revocation) {
                await revoke(identity, work, trusted, head, previousRun)
                return
            }
        } else if (work.status !== 'approved') {
            return
        }
        if (existing.release || existing.revocation)
            throw new Error('App version already used in the signed catalog')
        await publish(identity, work, trusted, head, previousRun)
    }

    async function publish(
        identity: Identity,
        work: Work,
        trusted: TrustedCatalog,
        head: string,
        previousRun?: PriorRun,
    ) {
        const { approval, bundle, evidence } = work
        const { release } = approval.candidate
        const handoff = { approval, bundle, evidence }
        const next = parseCatalog({
            ...trusted.catalog,
            revision: trusted.catalog.revision + 1,
            releases: [...trusted.catalog.releases, release],
        })
        // Check signability before committing to an immutable release.
        const files = await catalogUpdate(trusted, next, keys)

        async function authorize() {
            const current = await marketplace({
                operation: 'authorize',
                ...identity,
                previousRun,
            })
            if (!isDeepStrictEqual(current, handoff))
                throw new Error(
                    'Publication authorization no longer matches the candidate',
                )
        }
        if (!previousRun) {
            await options.withBundle(handoff, async (assets) => {
                await authorize()
                await distribution.ensureRelease(release, assets, authorize)
            })
        }
        const promoted = await promote(trusted, next, head, files, authorize)
        await recordPublication(
            identity,
            release,
            promoted.verified,
            promoted.head,
        )
    }

    async function recordPublication(
        identity: Identity,
        release: Catalog['releases'][number],
        verified: TrustedCatalog,
        head: string,
        previousRun?: PriorRun,
    ) {
        const outcome = await marketplace({
            operation: 'published',
            ...identity,
            previousRun,
            catalogRevision: verified.catalog.revision,
            publishedAt: new Date().toISOString(),
            release,
        })
        if (outcome.status === 'revoked') {
            const stopped = await marketplace({ operation: 'get', ...identity })
            await revoke(identity, stopped, verified, head)
        }
    }

    async function promote(
        trusted: TrustedCatalog,
        next: Catalog,
        head: string,
        files: ReadonlyMap<string, Buffer>,
        authorize?: () => Promise<void>,
    ) {
        if (!files.size)
            throw new Error('Catalog change produced no signed metadata')
        const newHead = await distribution.promote(head, files, authorize)
        const verified = await loadDistributionCatalog(
            distribution,
            root,
            newHead,
            false,
            trusted,
        )
        if (!isDeepStrictEqual(verified.catalog, next))
            throw new Error('Public catalog differs from the signed update')
        return { verified, head: newHead }
    }

    async function revoke(
        identity: Identity,
        work: Work,
        trusted: TrustedCatalog,
        head: string,
        previousRun?: PriorRun,
    ) {
        if ((!work.publication && !previousRun) || !work.revocation)
            throw new Error('Revocation has no matching publication and stop')
        const { revocation } = work
        const { release } = work.approval.candidate
        if (
            revocation.appId !== release.appId ||
            revocation.version !== release.version
        )
            throw new Error('Revocation names a different app version')
        const existing = catalogEntry(trusted.catalog, release)
        let verified = trusted
        if (existing.revocation) {
            if (!isDeepStrictEqual(existing.revocation, revocation))
                throw new Error(
                    'Signed revocation differs from the recorded stop',
                )
        } else {
            if (!previousRun && !isDeepStrictEqual(existing.release, release))
                throw new Error('Revocation has no matching signed app version')
            const next = parseCatalog({
                ...trusted.catalog,
                revision: trusted.catalog.revision + 1,
                releases: trusted.catalog.releases.filter(
                    (listed) => listed !== existing.release,
                ),
                revocations: [...trusted.catalog.revocations, revocation],
            })
            const files = await catalogUpdate(trusted, next, keys)
            verified = (await promote(trusted, next, head, files)).verified
        }
        await marketplace({
            operation: 'confirmRevocation',
            ...identity,
            previousRun,
            catalogRevision: verified.catalog.revision,
            revocation,
        })
    }
}
