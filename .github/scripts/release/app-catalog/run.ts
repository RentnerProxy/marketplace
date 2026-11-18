import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { commit } from '../../../../contracts/v1/primitives.ts'
import { CANDIDATE_PIPELINE as pipeline } from '../../../../web/src/config/submissions.config.ts'
import { requireDriverCheckout } from '../../ci/app-candidates/context.ts'
import { withCandidateBundle } from './artifact.ts'
import { createDistribution } from './distribution.ts'
import { marketplacePublisher } from './marketplace.ts'
import { publishCatalogQueue, refreshDistributionCatalog } from './publisher.ts'
import { catalogBootstrap, type SigningKeys } from './tuf.ts'

function setting(name: string) {
    const value = process.env[name]
    if (!value?.trim()) throw new Error(`Missing required setting ${name}`)
    return value.trim()
}

function rootBytes(value: string) {
    if (value.length > 128 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
        throw new Error('Invalid encoded catalog root')
    const bytes = Buffer.from(value, 'base64')
    if (bytes.toString('base64') !== value)
        throw new Error('Catalog root must use canonical Base64')
    return bytes
}

function signingKeys(): SigningKeys {
    return {
        targets: setting('APP_CATALOG_TARGETS_KEY'),
        snapshot: setting('APP_CATALOG_SNAPSHOT_KEY'),
        timestamp: setting('APP_CATALOG_TIMESTAMP_KEY'),
    }
}

async function bootstrap(destination: string, root: Buffer, keys: SigningKeys) {
    const files = await catalogBootstrap(root, keys)
    const out = resolve(destination)
    await mkdir(out, { mode: 0o700 })
    for (const [name, bytes] of files) {
        const path = join(out, name)
        // Specify a fresh destination and never replace previously signed bytes.
        // oxlint-disable-next-line no-await-in-loop
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        // oxlint-disable-next-line no-await-in-loop
        await writeFile(path, bytes, { flag: 'wx', mode: 0o644 })
    }
    console.log(
        'Created a signed bootstrap catalog in the requested local directory',
    )
}

async function main() {
    const [command, destination, ...rest] = process.argv.slice(2)
    if (
        rest.length ||
        !['bootstrap', 'sync'].includes(command ?? '') ||
        (command === 'bootstrap' ? !destination : destination !== undefined)
    )
        throw new Error('Expected bootstrap <new-directory> or sync')

    const root = rootBytes(setting('APP_CATALOG_TRUSTED_ROOT'))
    const keys = signingKeys()
    if (command === 'bootstrap' && destination) {
        await bootstrap(destination, root, keys)
        return
    }

    if (
        process.env.GITHUB_ACTIONS !== 'true' ||
        process.env.GITHUB_REPOSITORY !== pipeline.repository ||
        process.env.GITHUB_REPOSITORY_ID !== pipeline.repositoryId ||
        process.env.GITHUB_REF !== 'refs/heads/' + pipeline.branch ||
        !['schedule', 'workflow_dispatch'].includes(
            process.env.GITHUB_EVENT_NAME ?? '',
        ) ||
        process.env.GITHUB_WORKFLOW_REF !==
            pipeline.repository +
                '/.github/workflows/app-catalog-publish.yml@refs/heads/' +
                pipeline.branch
    )
        throw new Error(
            'Catalog publication requires the protected Marketplace workflow on main',
        )
    const sha = commit.parse(process.env.GITHUB_SHA)
    if (process.env.GITHUB_WORKFLOW_SHA !== sha)
        throw new Error('Catalog workflow and source commits differ')
    await requireDriverCheckout(sha)

    const distribution = createDistribution(
        setting('APP_CATALOG_DISTRIBUTION_TOKEN'),
    )
    const next = process.env.APP_CATALOG_NEXT_ROOT?.trim()
    // Metadata refresh depends solely on the public distribution and its keys.
    await refreshDistributionCatalog(
        distribution,
        root,
        keys,
        next ? rootBytes(next) : undefined,
    )
    console.log('Signed catalog metadata is current')

    const marketplace = marketplacePublisher(process.env)
    const sourceToken = setting('GH_TOKEN')
    const runnerTemp = setting('RUNNER_TEMP')
    await publishCatalogQueue({
        distribution,
        marketplace,
        root,
        keys,
        withBundle: (handoff, use) =>
            withCandidateBundle(handoff, sourceToken, runnerTemp, use),
    })
    console.log('Marketplace publication queue processed')
}

if (import.meta.main) {
    try {
        await main()
    } catch (error) {
        // Never print request, artifact or key material from this privileged job.
        const message =
            error instanceof z.ZodError
                ? 'Catalog metadata or publisher response violates its schema'
                : error instanceof Error
                  ? error.message
                  : 'Catalog publication failed'
        console.error(
            'App catalog publisher: ' +
                message.replace(/\p{Cc}/gu, ' ').slice(0, 220),
        )
        process.exitCode = 1
    }
}
