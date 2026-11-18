import { z } from 'zod'
import {
    catalog,
    catalogRelease,
    packageArtifact,
    revocation,
} from './catalog.ts'
import { httpComponents, httpPaths } from './http.ts'
import { rpcLimits } from './http-operations.ts'
import { appManifest } from './manifest.ts'
import { jsonValue, platformApiSchemas } from './platform-api.ts'
import { contractVersion, sourceIdentity } from './primitives.ts'
import { providerSchemas } from './provider-api.ts'
import { approval, candidate, publication } from './publication.ts'
import { runtimeSchemas } from './runtime.ts'
import { uiBridgeSchemas } from './ui-bridge.ts'
import { operation, problem } from './wire.ts'

export const protocolSchemas = {
    ...runtimeSchemas,
    ...providerSchemas,
    ...platformApiSchemas,
    ...uiBridgeSchemas,
    Problem: problem,
    Operation: operation,
}

const schemas = {
    JsonValue: jsonValue,
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

const compatibility = {
    requests:
        'Versioned requests and closed package, approval, credential and bridge records reject unknown fields. Omitted optional fields are absent. Null is valid only where explicitly declared.',
    responses:
        'Readers tolerate additional fields only in open response schemas. Unknown discriminants, required capabilities and security-relevant values are rejected.',
    encoding:
        'JSON member names use camelCase. IDs, revisions and cursors are strings. Timestamps use UTC with milliseconds. Integers stay within the exact JSON range. Decoders must reject duplicate members.',
    evolution:
        'Within v1 preserve required fields, units, defaults and semantics. Add new optional response fields only to open shapes. Breaking wire changes require a new major version and negotiation before use.',
    admission:
        'Check payload bounds and authenticated identity before dispatch. Recheck current installation generation, user delegation, capability and resource scope at the platform boundary. Bound concurrent requests per installation.',
    optionalMarketplace:
        'Use separate bounded background requests and keep enrichment outside trusted catalog and installation decisions. Cache or omit enrichment if unavailable. Respect the advertised request size, page and deadline limits.',
}

const runtimeEvidence = {
    profile: 'rentnerproxy-linux-v1',
    platformCommit: '195bd9b66dec662c9bb81ca2b1a3a4f889f15f3f',
    workflowRun:
        'https://github.com/RentnerProxy/platform/actions/runs/44192659551',
    bunVersion: '1.4.4',
    highestReferencedGlibc: '2.17',
    testedTargets: [
        {
            target: 'linux-amd64',
            machine: 'x86_64',
            kernel: '7.0.0-1014-aws',
            libc: 'glibc 2.41',
            elfAbi: 'Linux 3.2.0',
        },
        {
            target: 'linux-arm64',
            machine: 'aarch64',
            kernel: '7.0.0-1017-azure',
            libc: 'glibc 2.41',
            elfAbi: 'Linux 3.7.0',
        },
    ],
    description:
        'Observed appliances verified both private sockets, generation revocation, frame-bound UI and signed local installation followed by offline startup. These measurements describe the exercised environments. Package admission checks the target and runtime profile on the actual appliance.',
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
            'x-rentnerproxy-compatibility': compatibility,
        },
        'openapi.json': {
            openapi: '3.1.2',
            info: {
                title: 'RentnerProxy App Protocol',
                version: contractVersion,
                description:
                    'Stable version 1 contract for native apps. HTTP uses the declared private Unix socket for each operation. The matching SDK verifies cross-record invariants. Platform authorization is required at the runtime boundary.',
            },
            paths: httpPaths,
            'x-rentnerproxy-rpc-limits': rpcLimits,
            'x-rentnerproxy-compatibility': compatibility,
            'x-rentnerproxy-runtime-evidence': runtimeEvidence,
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
