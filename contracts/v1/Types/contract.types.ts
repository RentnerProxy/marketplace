import type { z } from 'zod'
import type { catalog, catalogRelease, packageArtifact } from '../catalog.ts'
import type { appManifest } from '../manifest.ts'
import type { approval, candidate, publication } from '../publication.ts'
import type { protocolSchemas } from '../schemas.ts'

export type AppManifest = z.infer<typeof appManifest>
export type CatalogRelease = z.infer<typeof catalogRelease>
export type PackageArtifact = z.infer<typeof packageArtifact>
export type Catalog = z.infer<typeof catalog>
export type Candidate = z.infer<typeof candidate>
export type Approval = z.infer<typeof approval>
export type Publication = z.infer<typeof publication>
export type ProtocolDocumentName = keyof typeof protocolSchemas
export type ProtocolDocument<Name extends ProtocolDocumentName> = z.output<
    (typeof protocolSchemas)[Name]
>

export type ContractErrorCode =
    | 'invalidShape'
    | 'invalidManifest'
    | 'incompatibleManifest'
    | 'invalidRelease'
    | 'invalidCandidate'
    | 'invalidCatalog'
    | 'approvalMismatch'
    | 'publicationMismatch'
