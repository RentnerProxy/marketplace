import { z } from 'zod'
import {
    catalog,
    catalogRelease,
    packageArtifact,
    revocation,
} from './catalog.ts'
import { httpComponents, httpPaths } from './http.ts'
import { appManifest } from './manifest.ts'
import { contractVersion, sourceIdentity } from './primitives.ts'
import { providerSchemas } from './provider-api.ts'
import { approval, candidate, publication } from './publication.ts'
import { runtimeSchemas } from './runtime.ts'
import { uiBridgeSchemas } from './ui-bridge.ts'
import { operation, problem } from './wire.ts'

export const protocolSchemas = {
    ...runtimeSchemas,
    ...providerSchemas,
    ...uiBridgeSchemas,
    Problem: problem,
    Operation: operation,
}

const schemas = {
    SourceIdentity: sourceIdentity,
    AppManifest: appManifest,
    PackageArtifact: packageArtifact,
    CatalogRelease: catalogRelease,
    Revocation: revocation,
    Catalog: catalog,
    Candidate: candidate,
    Approval: approval,
    Publication: publication,
    ...protocolSchemas,
}

export function buildContractDocuments() {
    const registry = z.registry<{ id: string }>()
    for (const [id, schema] of Object.entries(schemas))
        registry.add(schema, { id })
    const converted = z.toJSONSchema(registry, {
        target: 'draft-2020-12',
        uri: (id) => '#/$defs/' + id,
        override: ({ jsonSchema }) => {
            // Both SDKs validate the IPv6 format, including embedded IPv4 notation.
            if (jsonSchema.format === 'ipv6') delete jsonSchema.pattern
        },
    })
    const definitions = Object.fromEntries(
        Object.entries(converted.schemas).map(([name, schema]) => {
            const { $schema: _dialect, $id: _localId, ...definition } = schema
            return [name, definition]
        }),
    )

    return {
        'contracts.schema.json': {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: 'urn:rentnerproxy:app-contracts:' + contractVersion,
            title: 'RentnerProxy App Contracts',
            description:
                'Enable JSON Schema format assertions when validating these documents. The SDK validates formats including IP addresses and timestamps.',
            $ref: '#/$defs/Catalog',
            $defs: definitions,
            'x-rentnerproxy-protocol-documents': Object.keys(protocolSchemas),
        },
        'openapi.json': {
            openapi: '3.1.2',
            info: {
                title: 'RentnerProxy App Protocol Preview',
                version: contractVersion,
                description:
                    'Preview contract for native apps. HTTP uses the declared private Unix socket for each operation. Platform authorization is required at the runtime boundary. Package and publication records use the matching SDK for cross-record checks.',
            },
            paths: httpPaths,
            'x-rentnerproxy-rpc-limits': {
                maxJsonBytes: 1_048_576,
                maxListEntries: 100,
                defaultDeadlineMs: 10_000,
                maxDeadlineMs: 30_000,
            },
            components: {
                ...httpComponents,
                schemas: Object.fromEntries(
                    Object.keys(schemas).map((name) => [
                        name,
                        { $ref: './contracts.schema.json#/$defs/' + name },
                    ]),
                ),
            },
        },
    }
}
