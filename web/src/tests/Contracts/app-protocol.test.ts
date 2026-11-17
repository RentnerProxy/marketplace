import { describe, expect, test } from 'bun:test'
import fixtures from '../../../../contracts/v1/protocol-fixtures.json'
import { buildContractDocuments } from '../../../../contracts/v1/schemas.ts'
import type { ProtocolDocumentName } from '../../../../contracts/v1/Types/contract.types.ts'
import {
    ContractError,
    parseProtocolDocument,
} from '../../../../contracts/v1/validation.ts'

describe('preview app protocol', () => {
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

    test('advertises the private direction, authentication, and request controls', () => {
        const { paths, components } = buildContractDocuments()['openapi.json']
        const app = paths['/app/v1/ready'].get
        const platform = paths['/platform/v1/context'].get
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
                .parameters,
        ).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' })
        expect(paths['/platform/v1/events'].get.parameters).toContainEqual({
            $ref: '#/components/parameters/ResumeCursor',
        })
        expect(components.parameters.ResumeCursor.name).toBe('Last-Event-ID')
    })
})
