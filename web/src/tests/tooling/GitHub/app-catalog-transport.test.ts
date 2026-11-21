import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import {
    catalogPublicationPath,
    catalogPublisherAudience,
} from '@/lib/Marketplace/catalogPublication.ts'
import { marketplacePublisher } from '../../../../../.github/scripts/release/app-catalog/marketplace.ts'

const environment = {
    APP_CATALOG_PUBLISHER_IP: '172.31.249.2',
    APP_CATALOG_PUBLISHER_CA: 'dedicated test CA',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-identity-request-token',
    ACTIONS_ID_TOKEN_REQUEST_URL:
        'https://runner.actions.githubusercontent.com/oidc',
}

afterEach(() => mock.restore())

test.each([
    undefined,
    'market.rentner.dev',
    '203.0.113.5',
    '172.32.0.1',
    '127.0.0.1',
    '172.31.249.2:8443',
])('publisher rejects a non-private or invalid address %s', (address) => {
    expect(() =>
        marketplacePublisher({
            ...environment,
            APP_CATALOG_PUBLISHER_IP: address,
        }),
    ).toThrow('requires a private IPv4 address')
})

test('publisher requires the dedicated CA', () => {
    expect(() =>
        marketplacePublisher({ ...environment, APP_CATALOG_PUBLISHER_CA: '' }),
    ).toThrow('publisher CA is required')
})

test('publisher scopes its OIDC token and CA to the private POST', async () => {
    const fetch = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
            Response.json({ value: 'header.claims.signature' }),
        )
        .mockResolvedValueOnce(Response.json({ items: [] }))

    const publish = marketplacePublisher(environment)
    expect(await publish({ operation: 'queue' })).toEqual({ items: [] })

    const identityUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL)
    identityUrl.searchParams.set('audience', catalogPublisherAudience)
    expect(fetch.mock.calls[0]?.[0]).toEqual(identityUrl)
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('tls')
    expect(fetch.mock.calls[1]?.[0]).toBe(
        `https://${environment.APP_CATALOG_PUBLISHER_IP}:8443${catalogPublicationPath}`,
    )
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        method: 'POST',
        headers: { Authorization: 'Bearer header.claims.signature' },
        tls: {
            ca: environment.APP_CATALOG_PUBLISHER_CA,
            rejectUnauthorized: true,
        },
        redirect: 'error',
    })
})
