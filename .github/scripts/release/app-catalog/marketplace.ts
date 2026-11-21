import { isIPv4 } from 'node:net'
import type { z } from 'zod'
import {
    catalogPublicationAuthorization,
    catalogPublicationPath,
    catalogPublicationQueue,
    catalogPublicationRequest,
    catalogPublicationStatus,
    catalogPublicationWork,
    catalogPublisherAudience,
} from '../../../../web/src/lib/Marketplace/catalogPublication.ts'
import { readBoundedBytes } from '../../../../web/src/server/Marketplace/Submissions/github.service.ts'

type Request = z.output<typeof catalogPublicationRequest>
type Operation = Request['operation']

const responses = {
    queue: catalogPublicationQueue,
    get: catalogPublicationWork,
    authorize: catalogPublicationAuthorization,
    authorizeDraftCleanup: catalogPublicationStatus,
    defer: catalogPublicationStatus,
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

function publisherEndpoint(address: string | undefined) {
    if (!address || !isIPv4(address))
        throw new Error('Marketplace publisher requires a private IPv4 address')

    const [first, second] = address.split('.').map(Number)
    if (
        first !== 10 &&
        !(first === 172 && second >= 16 && second <= 31) &&
        !(first === 192 && second === 168)
    )
        throw new Error('Marketplace publisher requires a private IPv4 address')

    return `https://${address}:8443${catalogPublicationPath}`
}

export function marketplacePublisher(environment: NodeJS.ProcessEnv) {
    const endpoint = publisherEndpoint(environment.APP_CATALOG_PUBLISHER_IP)
    const ca = environment.APP_CATALOG_PUBLISHER_CA?.trim()
    if (!ca) throw new Error('Marketplace publisher CA is required')

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
        const response = await fetch(endpoint, {
            method: 'POST',
            tls: { ca, rejectUnauthorized: true },
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
