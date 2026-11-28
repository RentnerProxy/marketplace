import { z } from 'zod'
import {
    catalog,
    catalogIcon,
    packageArtifact,
    releaseDistribution,
} from './catalog.ts'
import { appManifest } from './manifest.ts'
import { v1ProtocolVersion } from './primitives.ts'
import { approval, candidate, publication } from './publication.ts'
import { protocolSchemas } from './schemas.ts'
import type {
    AppManifest,
    Candidate,
    CatalogRelease,
    ContractErrorCode,
    ProtocolDocument,
    ProtocolDocumentName,
} from './Types/contract.types.ts'
import { isWireJson } from './wire.ts'

export class ContractError extends Error {
    constructor(
        readonly code: ContractErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'ContractError'
    }
}

function parseStructure<Output>(
    schema: z.core.$ZodType<Output>,
    input: unknown,
): Output {
    const result = z.safeParse(schema, input)
    if (!result.success) {
        throw new ContractError(
            'invalidShape',
            'Invalid v1 contract structure.',
        )
    }
    return result.data
}

const protocolValidators: {
    [Name in ProtocolDocumentName]: z.core.$ZodType<ProtocolDocument<Name>>
} = protocolSchemas

function matchesProtocolSchema<Output>(
    schema: z.core.$ZodType<Output>,
    input: unknown,
): input is Output {
    return isWireJson(input) && z.safeParse(schema, input).success
}

/** Validate already-decoded wire JSON and retain its application payload and open response fields. */
export function parseProtocolDocument<Name extends ProtocolDocumentName>(
    name: Name,
    input: unknown,
): ProtocolDocument<Name> {
    if (!Object.hasOwn(protocolValidators, name)) {
        throw new ContractError('invalidShape', 'Unknown v1 protocol document.')
    }
    if (!matchesProtocolSchema(protocolValidators[name], input)) {
        throw new ContractError('invalidShape', 'Invalid v1 protocol document.')
    }
    return input
}

function unique(values: readonly (string | number)[]) {
    return new Set(values).size === values.length
}

function versionNumber(version: string) {
    return version
        .split('.')
        .reduce((value, part) => value * 1_000_000 + Number(part), 0)
}

function rangeBounds(range: string) {
    const separator = range.indexOf(' <')
    return [
        versionNumber(range.slice(2, separator)),
        versionNumber(range.slice(separator + 2)),
    ] as const
}

function orderedRange(range: string) {
    const [minimum, maximum] = rangeBounds(range)
    return minimum < maximum
}

function supportsProtocol(range: string, available: string | undefined) {
    const parsed = v1ProtocolVersion.safeParse(available)
    if (!parsed.success) return false
    const version = versionNumber(parsed.data)
    const [minimum, maximum] = rangeBounds(range)
    return minimum <= version && version < maximum
}

function validMigrations(data: NonNullable<AppManifest['data']>) {
    const { migrations, targetVersion } = data
    const starts = new Set(migrations.map(({ fromVersion }) => fromVersion))
    let previous = -1
    for (const { fromVersion, toVersion } of migrations) {
        if (
            fromVersion <= previous ||
            toVersion <= fromVersion ||
            toVersion > targetVersion ||
            (toVersion !== targetVersion && !starts.has(toVersion))
        )
            return false
        previous = fromVersion
    }
    return true
}

function validateManifest(manifest: AppManifest) {
    const { capabilities, data, permissions, providers, requires, ui } =
        manifest
    if (
        !orderedRange(requires.platformApi) ||
        !orderedRange(requires.appProtocol) ||
        Boolean(ui) !== Boolean(requires.uiBridge) ||
        (requires.uiBridge !== undefined && !orderedRange(requires.uiBridge))
    ) {
        throw new ContractError(
            'invalidManifest',
            'Invalid protocol range or UI requirements.',
        )
    }
    if (
        !unique(capabilities.map(({ id }) => id)) ||
        !unique(permissions) ||
        !unique(providers) ||
        !unique(requires.engineCapabilities) ||
        (ui !== undefined && !unique(ui.slots))
    ) {
        throw new ContractError(
            'invalidManifest',
            'Duplicate manifest declarations.',
        )
    }
    if (
        data &&
        (!unique(data.readVersions) ||
            !unique(data.writeVersions) ||
            !data.writeVersions.includes(data.targetVersion) ||
            !data.writeVersions.every((version) =>
                data.readVersions.includes(version),
            ) ||
            !validMigrations(data))
    ) {
        throw new ContractError(
            'invalidManifest',
            'Inconsistent data versions or migrations.',
        )
    }
    const { incidentCategories } = manifest
    const managesIncidents = capabilities.some(
        ({ id }) => id === 'notifications.incidents.manage.v1',
    )
    if (
        managesIncidents !== (incidentCategories !== undefined) ||
        (incidentCategories !== undefined &&
            !unique(incidentCategories.map(({ id }) => id)))
    ) {
        throw new ContractError(
            'invalidManifest',
            'Incident categories and their capability must be declared together, with unique IDs.',
        )
    }
}

function orderedRecord(record: object) {
    return JSON.stringify(record, (_key, value: unknown) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            return value
        const entries: [string, unknown][] = Object.entries(value)
        return Object.fromEntries(
            entries.toSorted(([a], [b]) => a.localeCompare(b, 'en')),
        )
    })
}

function sameRecord(left: object, right: object) {
    // Compare record members independently of key order and preserve array order.
    return orderedRecord(left) === orderedRecord(right)
}

function validateRelease(release: CatalogRelease) {
    const { appId, packages, publisher, source, version } = release
    if (
        !appId.startsWith(publisher.namespace + '.') ||
        !unique(packages.map(({ manifest }) => manifest.target)) ||
        (publisher.namespace === 'rentnerproxy' && packages.length !== 2)
    ) {
        throw new ContractError(
            'invalidRelease',
            'Invalid publisher namespace or package targets.',
        )
    }

    const display = packages[0].manifest.display
    for (const { manifest } of packages) {
        validateManifest(manifest)
        if (
            manifest.id !== appId ||
            manifest.version !== version ||
            !sameRecord(manifest.source, source) ||
            !sameRecord(manifest.display, display)
        ) {
            throw new ContractError(
                'invalidRelease',
                'Package manifest does not match the release.',
            )
        }
    }
}

function validateCandidate(record: Candidate) {
    validateRelease(record.release)
    if (!sameRecord(record.source, record.release.source)) {
        throw new ContractError(
            'invalidCandidate',
            'Candidate and release source must agree.',
        )
    }
}

export function parseAppManifest(input: unknown) {
    const manifest = parseStructure(appManifest, input)
    validateManifest(manifest)
    return manifest
}

export interface ManifestEnvironment {
    readonly target: string
    readonly runtimeProfile: string
    readonly platformApi: string
    readonly appProtocol: string
    readonly uiBridge?: string
    readonly engineCapabilities: readonly string[]
}

/** Compare requirements with the capabilities of the trusted local runtime. */
export function checkManifestCompatibility(
    input: unknown,
    environment: ManifestEnvironment,
) {
    const manifest = parseAppManifest(input)
    const { requires } = manifest
    if (
        manifest.target !== environment.target ||
        requires.runtimeProfile !== environment.runtimeProfile ||
        !supportsProtocol(requires.platformApi, environment.platformApi) ||
        !supportsProtocol(requires.appProtocol, environment.appProtocol) ||
        (requires.uiBridge !== undefined &&
            !supportsProtocol(requires.uiBridge, environment.uiBridge)) ||
        !requires.engineCapabilities.every((capability) =>
            environment.engineCapabilities.includes(capability),
        )
    ) {
        throw new ContractError(
            'incompatibleManifest',
            'The local runtime does not satisfy the manifest requirements.',
        )
    }
    return manifest
}

export function parseCatalog(input: unknown) {
    const snapshot = parseStructure(catalog, input)
    const identities = new Set<string>()
    for (const entry of [...snapshot.releases, ...snapshot.revocations]) {
        const identity = entry.appId + '@' + entry.version
        if (identities.has(identity)) {
            throw new ContractError(
                'invalidCatalog',
                'Duplicate or revoked catalog release.',
            )
        }
        identities.add(identity)
    }
    for (const release of snapshot.releases) validateRelease(release)
    return snapshot
}

export function parseCandidate(input: unknown) {
    const record = parseStructure(candidate, input)
    validateCandidate(record)
    return record
}

export function parseApproval(input: unknown) {
    const record = parseStructure(approval, input)
    validateCandidate(record.candidate)
    return record
}

export function parsePublication(input: unknown) {
    const receipt = parseStructure(publication, input)
    validateRelease(receipt.release)
    return receipt
}

// Pass the current candidate and approval from the trusted store. Shape and
// equality checks do not establish authorization, freshness or provenance.
export function checkApprovalBinding(
    candidateInput: unknown,
    approvalInput: unknown,
) {
    const current = parseCandidate(candidateInput)
    const approved = parseApproval(approvalInput)
    if (!sameRecord(current, approved.candidate)) {
        throw new ContractError(
            'approvalMismatch',
            'Candidate differs from the approved snapshot.',
        )
    }
    return current.release
}

export function checkPublicationBinding(
    approvalInput: unknown,
    publicationInput: unknown,
    catalogInput: unknown,
) {
    const approved = parseApproval(approvalInput)
    const receipt = parsePublication(publicationInput)
    const snapshot = parseCatalog(catalogInput)
    const published = snapshot.releases.find(
        ({ appId, version }) =>
            appId === receipt.release.appId &&
            version === receipt.release.version,
    )
    if (
        receipt.approvalId !== approved.id ||
        receipt.approvalRevision !== approved.revision ||
        receipt.catalogRevision !== snapshot.revision ||
        !published ||
        !sameRecord(receipt.release, approved.candidate.release) ||
        !sameRecord(receipt.release, published)
    ) {
        throw new ContractError(
            'publicationMismatch',
            'Publication does not match approval and catalog.',
        )
    }
    return receipt
}

/** Resolve download locations and byte identities from a trusted catalog. */
export function packageReleaseAssets(input: unknown) {
    const { manifest, archive, manifestSha256, sbom, provenance } =
        parseStructure(packageArtifact, input)
    validateManifest(manifest)
    const { id, version, target } = manifest
    const tag = id + '-v' + version
    const filename = id + '-' + version + '-' + target + '.tar.zst'
    const url = releaseDistribution + tag + '/' + filename
    return {
        archive: { ...archive, url },
        manifestSha256,
        sbom: { ...sbom, url: url + '.sbom.json' },
        provenance: { ...provenance, url: url + '.provenance.json' },
    }
}

export function packageDownloadUrl(input: unknown) {
    return packageReleaseAssets(input).archive.url
}

/** Resolve the icon target and byte identity from a trusted catalog. */
export function catalogIconTarget(input: unknown) {
    const { sha256, sizeBytes, format } = parseStructure(catalogIcon, input)
    return { path: 'assets/' + sha256 + '.' + format, sha256, sizeBytes }
}

export function catalogIconPath(input: unknown) {
    return catalogIconTarget(input).path
}
