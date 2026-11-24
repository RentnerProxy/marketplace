import { describe, expect, test } from 'bun:test'
import httpFixtures from '../../../../contracts/v1/http-fixtures.json'
import fixtures from '../../../../contracts/v1/protocol-fixtures.json'
import {
    pathParameterSchemas,
    type HttpOperationDefinition,
} from '../../../../contracts/v1/http-operations.ts'
import { providerProfile } from '../../../../contracts/v1/manifest.ts'
import { buildContractDocuments } from '../../../../contracts/v1/schemas.ts'
import {
    ContractError,
    httpOperations,
    parseHttpEvent,
    parseHttpResponse,
    parseProtocolDocument,
    prepareHttpRequest,
    rpcLimits,
    type HttpOperationName,
    type ProtocolDocumentName,
} from '../../../../contracts/v1/index.ts'

describe('app protocol v1', () => {
    for (const fixture of fixtures.cases) {
        test(fixture.schema + ' ' + fixture.title, () => {
            const name = fixture.schema as ProtocolDocumentName
            if (fixture.valid) {
                const parsed: unknown = parseProtocolDocument(
                    name,
                    fixture.document,
                )
                expect(parsed).toEqual(fixture.document)
            } else {
                expect(() =>
                    parseProtocolDocument(name, fixture.document),
                ).toThrow(ContractError)
            }
        })
    }

    test('rejects unknown schema names', () => {
        expect(() =>
            parseProtocolDocument('constructor' as ProtocolDocumentName, {}),
        ).toThrow(ContractError)
    })

    test('returns the type of the selected protocol document', () => {
        const readiness = parseProtocolDocument('AppReadiness', {
            ready: true,
            protocolVersion: '1.0.0',
            providers: [],
        })
        expect(readiness.ready).toBe(true)
        expect(readiness.providers).toEqual([])
    })

    test('bounds the depth of decoded wire JSON', () => {
        let document: Record<string, unknown> = {}
        for (let depth = 1; depth < rpcLimits.maxJsonDepth; depth++) {
            document = { nested: document }
        }
        expect(parseProtocolDocument('AppApiPayload', document)).toBeDefined()
        expect(() =>
            parseProtocolDocument('AppApiPayload', { nested: document }),
        ).toThrow(ContractError)
    })

    test('advertises the private direction, authentication, and request controls', () => {
        const { paths, components } = buildContractDocuments()['openapi.json']
        const app = paths['/app/v1/ready'].get
        const platform = paths['/platform/v1/context'].get
        if (!app || !platform)
            throw new Error('Required app operations are missing.')
        expect(app['x-rentnerproxy-socket']).toBe('app.sock')
        expect(app.security).toEqual([{ AppCredential: [] }])
        expect(platform['x-rentnerproxy-socket']).toBe('core.sock')
        expect(platform.security).toEqual([{ CoreCredential: [] }])
        for (const operation of [app, platform]) {
            expect(operation.parameters).toContainEqual({
                $ref: '#/components/parameters/Installation',
            })
            expect(operation.parameters).toContainEqual({
                $ref: '#/components/parameters/Generation',
            })
        }
        expect(
            paths['/platform/v1/operations/{operationId}/cancel'].post
                ?.parameters,
        ).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' })
        expect(paths['/platform/v1/events'].get?.parameters).toContainEqual({
            $ref: '#/components/parameters/ResumeCursor',
        })
        expect(components.parameters.ResumeCursor.name).toBe('Last-Event-ID')
    })

    test('advertises one OpenAPI route per SDK operation', () => {
        const { paths } = buildContractDocuments()['openapi.json']
        const operations = Object.entries(httpOperations)
        expect(
            Object.values(paths).flatMap((item) => Object.keys(item)),
        ).toHaveLength(operations.length)
        for (const [name, { method, path, socket, status }] of operations) {
            const metadata = paths[path]?.[method === 'GET' ? 'get' : 'post']
            expect(metadata?.operationId).toBe(name)
            expect(metadata?.['x-rentnerproxy-socket']).toBe(socket)
            expect(metadata?.responses[status]).toBeDefined()
        }
    })

    test('restricts each path parameter to its protocol document', () => {
        const { paths, components } = buildContractDocuments()['openapi.json']
        const operations: [string, HttpOperationDefinition][] =
            Object.entries(httpOperations)
        for (const [, { method, path, pathParameter }] of operations) {
            if (!pathParameter) continue
            const metadata = paths[path]?.[method === 'GET' ? 'get' : 'post']
            expect(metadata?.parameters).toContainEqual({
                $ref: '#/components/parameters/' + pathParameter,
            })
            expect(components.parameters[pathParameter]).toEqual({
                name: pathParameter,
                in: 'path',
                required: true,
                schema: {
                    $ref:
                        '#/components/schemas/' +
                        pathParameterSchemas[pathParameter],
                },
            })
        }
    })

    test('accepts exactly the provider profiles as legacy handoff domains', () => {
        const { $defs } = buildContractDocuments()['contracts.schema.json']
        expect($defs.LegacyHandoffDomain.enum).toEqual(providerProfile.options)
        for (const domain of providerProfile.options) {
            const { path } = prepareHttpRequest('getLegacyHandoff', {
                pathParameter: domain,
            })
            expect(path).toBe('/platform/v1/legacy-handoffs/' + domain)
        }
        expect(() =>
            prepareHttpRequest('getLegacyHandoff', {
                pathParameter: 'proxy-hosts',
            }),
        ).toThrow(ContractError)
    })

    const decimals = (length: number) =>
        Array.from({ length }, () => 0.000_001)
    const partSizes: [string, () => unknown, boolean][] = [
        ['ASCII at the limit', () => 'a'.repeat(262_142), true],
        ['ASCII above the limit', () => 'a'.repeat(262_143), false],
        ['UTF-8 at the limit', () => 'ä'.repeat(131_071), true],
        ['escapes at the limit', () => '\n'.repeat(131_071), true],
        ['escapes above the limit', () => '\n'.repeat(131_072), false],
        ['decimals at the limit', () => decimals(29_127), true],
        ['decimals above the limit', () => decimals(29_128), false],
    ]
    for (const [label, part, valid] of partSizes) {
        test('bounds a legacy handoff part: ' + label, () => {
            const check = () =>
                parseProtocolDocument('LegacyHandoffPart', {
                    sequence: 0,
                    part: part(),
                })
            if (valid) expect(check()).toBeDefined()
            else expect(check).toThrow(ContractError)
        })
    }
})

describe('app HTTP SDK v1', () => {
    for (const fixture of httpFixtures.requests) {
        test(fixture.title, () => {
            const operation = fixture.operation as HttpOperationName
            if (!fixture.expected) {
                expect(() =>
                    prepareHttpRequest(operation, fixture.options),
                ).toThrow(ContractError)
                return
            }
            const { method, socket, path, headers, body } = prepareHttpRequest(
                operation,
                fixture.options,
            )
            const route: unknown = { method, socket, path }
            expect(route).toEqual(fixture.expected)
            const expectedHeaders: Record<string, string> = {}
            if (fixture.options.idempotencyKey)
                expectedHeaders['Idempotency-Key'] =
                    fixture.options.idempotencyKey
            if (fixture.options.resumeCursor)
                expectedHeaders['Last-Event-ID'] = fixture.options.resumeCursor
            expect(headers).toEqual(expectedHeaders)
            const payload: unknown = body
            expect(payload).toEqual(fixture.options.body)
        })
    }
    for (const fixture of httpFixtures.responses) {
        test(fixture.title, () => {
            const operation = fixture.operation as HttpOperationName
            const check = () =>
                parseHttpResponse(operation, fixture.status, fixture.body)
            if (!fixture.valid) {
                expect(check).toThrow(ContractError)
                return
            }
            const response = check()
            const payload: unknown = response.ok
                ? response.data
                : response.problem
            expect(payload).toEqual(fixture.body)
        })
    }
    for (const fixture of httpFixtures.events) {
        test(fixture.title, () => {
            const operation = fixture.operation as HttpOperationName
            const check = (): unknown => parseHttpEvent(operation, fixture.body)
            if (fixture.valid) expect(check()).toEqual(fixture.body)
            else expect(check).toThrow(ContractError)
        })
    }

    test('preserves the type of the selected HTTP response', () => {
        const result = parseHttpResponse('getAppReadiness', 200, {
            ready: true,
            protocolVersion: '1.0.0',
            providers: [],
        })
        if (!result.ok) throw new Error('Expected readiness.')
        expect(result.data.ready).toBe(true)
        expect(result.data.providers).toEqual([])
    })
})
