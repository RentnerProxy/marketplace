import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import type { Catalog } from '../../../../contracts/v1/index.ts'
import type {
    catalogPublicationQueue,
    catalogPublicationWork,
    publicationHandoff,
} from '../../../../web/src/lib/Marketplace/catalogPublication.ts'
import { runAppPipeline } from '../../native-tools.ts'
import type { CatalogCore, TrustedCatalog } from './catalog-core.ts'
import type { createDistribution } from './distribution.ts'
import {
    PublicationResponseError,
    type marketplacePublisher,
} from './marketplace.ts'

type QueueItem = z.output<typeof catalogPublicationQueue>['items'][number]
type Work = z.output<typeof catalogPublicationWork>
type Handoff = z.output<typeof publicationHandoff>
type Distribution = ReturnType<typeof createDistribution>
type Marketplace = ReturnType<typeof marketplacePublisher>
type Identity = Pick<QueueItem, 'submissionId' | 'approvalRevision'>
type PriorRun = Pick<NonNullable<Work['run']>, 'runId' | 'attempt'>
type ObserveRevision = (revision: number) => void
type CatalogReadOptions = Parameters<CatalogCore['read']>[2]

interface PublisherOptions {
    distribution: Distribution
    marketplace: Marketplace
    root: Buffer
    core: CatalogCore
    withBundle: <T>(
        handoff: Handoff,
        use: (files: ReadonlyMap<string, string>) => Promise<T>,
    ) => Promise<T>
}

type PublicationAction =
    'idle' | 'publish' | 'revoke' | 'revokePrior' | 'recordPrior' | 'inspect'
type RecoveryAction = 'revoke' | 'discardDraft' | 'reset' | 'publish'

function isConflict(error: unknown) {
    return error instanceof PublicationResponseError && error.status === 409
}

export async function loadDistributionCatalog(
    core: CatalogCore,
    distribution: Distribution,
    root: Buffer,
    head: string,
    options?: CatalogReadOptions,
) {
    return core.read(
        (path, maxBytes) => distribution.readAt(head, path, maxBytes),
        root,
        options,
    )
}

export async function refreshDistributionCatalog(
    core: CatalogCore,
    distribution: Distribution,
    root: Buffer,
    nextRoot?: Buffer,
) {
    const head = await distribution.head()
    const trusted = await loadDistributionCatalog(
        core,
        distribution,
        root,
        head,
        {
            allowExpiredRoles: true,
            nextRoot,
        },
    )
    const files = await core.update(trusted, undefined, {
        nextRoot,
    })
    if (!files.size) return
    const updatedHead = await distribution.promote(head, files)
    await loadDistributionCatalog(core, distribution, root, updatedHead)
}

export async function publishCatalogQueue(options: PublisherOptions) {
    const { distribution, marketplace, root, core } = options
    const { items } = await marketplace({ operation: 'queue' })
    const deadline = Date.now() + 12 * 60_000
    const failures: unknown[] = []
    for (const item of items) {
        // Process from the newest persisted catalog in serial order.
        if (Date.now() >= deadline) break
        const { submissionId, approvalRevision } = item
        const identity = { submissionId, approvalRevision }
        let revision = item.revision
        try {
            // oxlint-disable-next-line no-await-in-loop
            await processItem(identity, (observed) => {
                revision = observed
            })
        } catch (error) {
            // A stop or another state transition can win before authorization.
            if (isConflict(error)) continue
            failures.push(error)
            try {
                // oxlint-disable-next-line no-await-in-loop
                await marketplace({ operation: 'defer', ...identity, revision })
            } catch (deferError) {
                if (!isConflict(deferError)) failures.push(deferError)
            }
        }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
        throw new AggregateError(
            failures,
            `${failures.length} catalog queue items failed`,
        )

    async function getWork(identity: Identity, observe: ObserveRevision) {
        const work = await marketplace({ operation: 'get', ...identity })
        if (
            work.approval.id !== identity.submissionId ||
            work.approval.revision !== identity.approvalRevision
        )
            throw new Error('Marketplace returned a different approval')
        observe(work.revision)
        return work
    }

    async function processItem(identity: Identity, observe: ObserveRevision) {
        const work = await getWork(identity, observe)
        const head = await distribution.head()
        const trusted = await loadDistributionCatalog(
            core,
            distribution,
            root,
            head,
        )
        const release = work.approval.candidate.release
        const action = await runAppPipeline<PublicationAction>(
            'publication-plan',
            { catalog: trusted.catalog, work },
        )
        if (action === 'idle') return
        if (action === 'publish') {
            await publish(identity, work, trusted, head, observe)
            return
        }
        if (action === 'revoke') {
            await revoke(identity, work, trusted, head)
            return
        }
        if (!work.run) throw new Error('Catalog action requires a prior run')
        const previousRun = { runId: work.run.runId, attempt: work.run.attempt }
        if (action === 'revokePrior') {
            await revoke(identity, work, trusted, head, previousRun)
            return
        }
        if (action === 'recordPrior') {
            await distribution.verifyRelease(release)
            await recordPublication(
                identity,
                release,
                trusted,
                head,
                observe,
                previousRun,
            )
            return
        }
        const releaseState = await distribution.inspectRelease(release)
        const recovery = await runAppPipeline<RecoveryAction>(
            'publication-recovery',
            { state: releaseState, stopped: work.revocation !== null },
        )
        if (recovery === 'revoke') {
            await revoke(identity, work, trusted, head, previousRun)
            return
        }
        if (recovery === 'discardDraft') {
            await distribution.discardUnpublishedDraft(release, async () => {
                await marketplace({
                    operation: 'authorizeDraftCleanup',
                    ...identity,
                    previousRun,
                })
            })
        }
        if (recovery === 'discardDraft' || recovery === 'reset') {
            await marketplace({
                operation: 'neverPromoted',
                ...identity,
                previousRun,
            })
            return
        }
        if (releaseState === 'absent')
            throw new Error('Catalog recovery requires an existing release')
        await publish(identity, work, trusted, head, observe, {
            previousRun,
            releaseState,
        })
    }

    async function publish(
        identity: Identity,
        work: Work,
        trusted: TrustedCatalog,
        head: string,
        observe: ObserveRevision,
        recovery?: {
            previousRun: PriorRun
            releaseState: 'draft' | 'published'
        },
    ) {
        const { approval, bundle, evidence } = work
        const { release } = approval.candidate
        const handoff = { approval, bundle, evidence }
        const next = await runAppPipeline<Catalog>('publication-publish', {
            catalog: trusted.catalog,
            release,
        })
        // Check signability before committing to an immutable release.
        const files = await core.update(trusted, next)

        async function authorize() {
            const { revision, ...current } = await marketplace({
                operation: 'authorize',
                ...identity,
                previousRun: recovery?.previousRun,
            })
            if (!isDeepStrictEqual(current, handoff))
                throw new Error(
                    'Publication authorization no longer matches the candidate',
                )
            observe(revision)
        }
        if (recovery?.releaseState === 'published') {
            await distribution.verifyRelease(release)
        } else {
            await options.withBundle(handoff, async (assets) => {
                await authorize()
                await distribution.ensureRelease(release, assets, authorize)
            })
        }
        const promoted = await promote(next, head, files, authorize)
        await recordPublication(
            identity,
            release,
            promoted.verified,
            promoted.head,
            observe,
        )
    }

    async function recordPublication(
        identity: Identity,
        release: Catalog['releases'][number],
        verified: TrustedCatalog,
        head: string,
        observe: ObserveRevision,
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
            const stopped = await getWork(identity, observe)
            await revoke(identity, stopped, verified, head)
        }
    }

    async function promote(
        next: Catalog,
        head: string,
        files: ReadonlyMap<string, Buffer>,
        authorize?: () => Promise<void>,
    ) {
        if (!files.size)
            throw new Error('Catalog change produced no signed metadata')
        const newHead = await distribution.promote(head, files, authorize)
        const verified = await loadDistributionCatalog(
            core,
            distribution,
            root,
            newHead,
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
        const next = await runAppPipeline<Catalog | null>('publication-stop', {
            catalog: trusted.catalog,
            work,
            previousRun: previousRun !== undefined,
        })
        const { revocation } = work
        if (!revocation)
            throw new Error('Revocation has no matching publication and stop')
        let verified = trusted
        if (next) {
            const files = await core.update(trusted, next)
            verified = (await promote(next, head, files)).verified
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
