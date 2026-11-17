import { z } from 'zod'
import { appManifest } from './manifest.ts'
import {
    appId,
    appVersion,
    archive,
    displayName,
    formatVersion,
    namespace,
    positiveInteger,
    releaseNotes,
    sha256,
    sourceIdentity,
    timestamp,
} from './primitives.ts'

export const releaseDistribution =
    'https://github.com/RentnerProxy/app-catalog/releases/download/'

export const catalogIcon = z
    .strictObject({
        format: z.enum(['png', 'webp']),
        sha256,
        sizeBytes: z.number().int().min(1).max(2_097_152),
    })
    .describe(
        'Verified catalog target at assets/<sha256>.<format>, relative to the catalog repository.',
    )

const releaseEvidence = z.strictObject({
    sha256,
    sizeBytes: z.number().int().min(1).max(16_777_216),
})

export const packageArtifact = z.strictObject({
    manifest: appManifest,
    archive,
    manifestSha256: sha256.describe(
        'SHA-256 of the exact app.json bytes inside the archive.',
    ),
    sbom: releaseEvidence.describe(
        'Release asset <archive filename>.sbom.json.',
    ),
    provenance: releaseEvidence.describe(
        'Release asset <archive filename>.provenance.json.',
    ),
})

export const catalogRelease = z
    .strictObject({
        appId,
        version: appVersion,
        source: sourceIdentity,
        publisher: z
            .strictObject({
                namespace,
                name: displayName,
            })
            .describe(
                'Signed public display identity. The namespace must match the app ID. Only the trusted RentnerProxy publisher owns rentnerproxy.',
            ),
        packages: z.array(packageArtifact).min(1).max(2),
        icon: catalogIcon.optional(),
        notes: releaseNotes.optional(),
    })
    .describe(
        'Public install/display data for one version. Each target has its own manifest and archive identity. The release tag is <appId>-v<version> and the asset is <appId>-<version>-<target>.tar.zst in RentnerProxy/app-catalog.',
    )

export const revocation = z
    .strictObject({
        appId,
        version: appVersion,
        revokedAt: timestamp,
        reason: z.enum(['withdrawn', 'security', 'invalidPublication']),
    })
    .describe('Revocation applies to all targets of the specified app version.')

export const catalog = z
    .strictObject({
        formatVersion,
        revision: positiveInteger,
        releases: z.array(catalogRelease).max(4096),
        revocations: z.array(revocation).max(4096),
    })
    .describe(
        'Catalog target payload for TUF. Verify its bytes and metadata before use. Releases and revocations are unique by app ID and version and disjoint. Website account, rating, and statistics data are outside this contract.',
    )
