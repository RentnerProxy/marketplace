import { z } from 'zod'
import {
    catalog,
    catalogRelease,
    packageArtifact,
    revocation,
} from './catalog.ts'
import { appManifest } from './manifest.ts'
import { contractVersion, sourceIdentity } from './primitives.ts'
import { approval, candidate, publication } from './publication.ts'
import { operation, problem } from './wire.ts'

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
    Problem: problem,
    Operation: operation,
}

export function buildContractDocuments() {
    const registry = z.registry<{ id: string }>()
    for (const [id, schema] of Object.entries(schemas))
        registry.add(schema, { id })
    const converted = z.toJSONSchema(registry, {
        target: 'draft-2020-12',
        uri: (id) => '#/$defs/' + id,
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
            $ref: '#/$defs/Catalog',
            $defs: definitions,
        },
        'openapi.json': {
            openapi: '3.1.2',
            info: {
                title: 'RentnerProxy App Contract Components',
                version: contractVersion,
                description:
                    'Preview components for package, catalog, and approval consumers. Use the matching contract SDK for cross-record validation.',
            },
            components: {
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
