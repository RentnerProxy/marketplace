import { logWarn } from '@/server/Logging/logger.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import { catalogPublicationRequest } from '@/lib/Marketplace/catalogPublication.ts'
import { ContractError } from '@rentnerproxy/app-contracts'
import { InvalidCandidateError } from './candidate-run.service.ts'
import { RepositoryOwnershipError } from './ownership.service.ts'
import {
    authenticateCatalogPublisherService,
    PublisherAuthenticationError,
} from './publisher-auth.service.ts'
import {
    authorizeDraftCleanupService,
    authorizePublicationAttemptService,
    confirmCatalogRevocationService,
    deferCatalogPublicationWorkService,
    getCatalogPublicationWorkService,
    listCatalogPublicationWorkService,
    reconcileCatalogPublisherService,
} from './publication.service.ts'
import { SubmissionConflictError } from './submission-store.service.ts'

const maxRequestBytes = 256 * 1024
const rateLimit = { limit: 300, windowMs: 15 * 60_000 }

async function readPublicationRequest(request: Request): Promise<unknown> {
    const contentType = request.headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()
        .toLowerCase()
    const length = request.headers.get('content-length')
    if (
        contentType !== 'application/json' ||
        !request.body ||
        (length !== null &&
            (!/^\d+$/.test(length) || Number(length) > maxRequestBytes))
    )
        return undefined

    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        for (;;) {
            // oxlint-disable-next-line no-await-in-loop -- Read one bounded chunk at a time.
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > maxRequestBytes) return undefined
            chunks.push(value)
        }
        return JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
                Buffer.concat(chunks),
            ),
        ) as unknown
    } catch {
        return undefined
    } finally {
        await reader.cancel().catch(() => undefined)
    }
}

function privateResponse(
    value: unknown,
    status = 200,
    headers?: Record<string, string>,
) {
    return Response.json(value, {
        status,
        headers: { 'cache-control': 'no-store', ...headers },
    })
}

export async function handleCatalogPublicationRequest({
    request,
}: {
    request: Request
}) {
    try {
        const run = await authenticateCatalogPublisherService(request)
        await enforceRateLimit({
            ...rateLimit,
            scope: 'marketplace-catalog-publication',
            identifiers: [run.repositoryId],
            includeClientIp: false,
        })
        const parsed = catalogPublicationRequest.safeParse(
            await readPublicationRequest(request),
        )
        if (!parsed.success)
            return privateResponse({ error: 'invalidRequest' }, 400)
        const input = parsed.data
        if (input.operation === 'queue') {
            return privateResponse({
                items: await listCatalogPublicationWorkService(),
            })
        }
        const identity = {
            submissionId: input.submissionId,
            approvalRevision: input.approvalRevision,
        }
        switch (input.operation) {
            case 'defer':
                return privateResponse({
                    status: await deferCatalogPublicationWorkService(
                        input,
                        run,
                    ),
                })
            case 'authorizeDraftCleanup':
                return privateResponse({
                    status: await authorizeDraftCleanupService(input),
                })
            case 'get':
                return privateResponse(
                    await getCatalogPublicationWorkService(identity),
                )
            case 'authorize':
                return privateResponse(
                    await authorizePublicationAttemptService({
                        ...identity,
                        run,
                        previousRun: input.previousRun,
                    }),
                )
            case 'published':
                return privateResponse({
                    status: await reconcileCatalogPublisherService(
                        identity,
                        run,
                        input,
                    ),
                })
            case 'neverPromoted':
                return privateResponse({
                    status: await reconcileCatalogPublisherService(
                        identity,
                        run,
                        { neverPromoted: true, previousRun: input.previousRun },
                    ),
                })
            default:
                return privateResponse({
                    status: await confirmCatalogRevocationService(
                        identity,
                        input.catalogRevision,
                        input.revocation,
                        input.previousRun,
                    ),
                })
        }
    } catch (error) {
        if (error instanceof PublisherAuthenticationError) {
            return privateResponse({ error: 'notAuthorized' }, 401, {
                'www-authenticate': 'Bearer',
            })
        }
        if (error instanceof RateLimitError) {
            return privateResponse({ error: 'rateLimited' }, 429, {
                'retry-after': String(error.retryAfterSeconds),
            })
        }
        if (
            error instanceof SubmissionConflictError ||
            error instanceof InvalidCandidateError ||
            error instanceof RepositoryOwnershipError ||
            error instanceof ContractError
        )
            return privateResponse({ error: 'conflict' }, 409)

        logWarn('marketplace.catalog.publisher_unavailable')
        return privateResponse({ error: 'unavailable' }, 503)
    }
}
