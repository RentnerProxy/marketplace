import type { z } from 'zod'
import {
    catalogPublicationPath,
    catalogPublicationQueue,
    catalogPublicationRequest,
    catalogPublicationStatus,
    catalogPublicationWork,
    catalogPublisherAudience,
    publicationHandoff,
} from '../../../../web/src/lib/Marketplace/catalogPublication.ts'
import { readBoundedBytes } from '../../../../web/src/server/Marketplace/Submissions/github.service.ts'

type Request = z.output<typeof catalogPublicationRequest>
type Operation = Request['operation']

const productionEndpoint = 'https://market.rentner.dev' + catalogPublicationPath
const responses = {
    queue: catalogPublicationQueue,
    get: catalogPublicationWork,
    authorize: publicationHandoff,
    neverPromoted: catalogPublicationStatus,
    published: catalogPublicationStatus,
    confirmRevocation: catalogPublicationStatus,
} as const
type PublicationResponses = {
    [K in Operation]: z.output<(typeof responses)[K]>
}
const decoders: { [K in Operation]: z.ZodType<PublicationResponses[K]> } =
    responses

export class PublicationResponseError extends Error {
    constructor(readonly status: number) {
        super(`Marketplace publication request failed (${status})`)
    }
}

export function marketplacePublisher(environment: NodeJS.ProcessEnv) {
    const requestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    const requestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL
    if (!requestToken || !requestUrl)
        throw new Error('GitHub Actions OIDC is unavailable')
    const identityUrl = new URL(requestUrl)
    if (
        identityUrl.protocol !== 'https:' ||
        identityUrl.port ||
        identityUrl.username ||
        identityUrl.password ||
        !identityUrl.hostname.endsWith('.actions.githubusercontent.com')
    )
        throw new Error('Unexpected GitHub Actions identity origin')
    identityUrl.searchParams.set('audience', catalogPublisherAudience)

    let current: { token: string; refreshAt: number } | undefined
    async function identity() {
        if (current && current.refreshAt > Date.now()) return current.token
        const response = await fetch(identityUrl, {
            headers: { Authorization: 'Bearer ' + requestToken },
            redirect: 'error',
            signal: AbortSignal.timeout(12_000),
        })
        const received: unknown = JSON.parse(
            (await readBoundedBytes(response, 32_768)).toString('utf8'),
        )
        if (
            typeof received !== 'object' ||
            received === null ||
            !('value' in received) ||
            typeof received.value !== 'string' ||
            !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(received.value)
        )
            throw new Error('GitHub Actions returned an invalid OIDC token')
        current = { token: received.value, refreshAt: Date.now() + 60_000 }
        return current.token
    }

    return async function request<K extends Operation>(
        input: Extract<Request, { operation: K }> & { operation: K },
    ): Promise<PublicationResponses[K]> {
        const body = catalogPublicationRequest.parse(input)
        const response = await fetch(productionEndpoint, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + (await identity()),
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(body),
            redirect: 'error',
            signal: AbortSignal.timeout(70_000),
        })
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined)
            throw new PublicationResponseError(response.status)
        }
        const bytes = await readBoundedBytes(response, 2 * 1024 * 1024)
        const value: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        )
        return decoders[input.operation].parse(value)
    }
}
