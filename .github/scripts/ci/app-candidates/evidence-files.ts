import { runAppPipeline } from '../../native-tools.ts'

export const evidenceLimit = 16 * 1024 * 1024
export const metadataLimit = 512 * 1024
// Allow zstd's small worst-case overhead on a 256 MiB admitted tar.
export const packageLimit = 257 * 1024 * 1024

interface FileIdentity {
    sha256: string
    sizeBytes: number
}

function identityFields(expected?: FileIdentity) {
    return (
        expected && { sha256: expected.sha256, sizeBytes: expected.sizeBytes }
    )
}

export function fileIdentity(
    path: string,
    limit: number,
    expected?: FileIdentity,
) {
    return runAppPipeline<FileIdentity>('evidence-file-identity', {
        path,
        limit,
        expected: identityFields(expected),
    })
}

export async function readJson(
    path: string,
    limit: number,
    expected?: FileIdentity,
) {
    const { bytes, value } = await runAppPipeline<{
        bytes: string
        value: unknown
    }>('evidence-read-json', {
        path,
        limit,
        expected: identityFields(expected),
    })
    return { bytes: Buffer.from(bytes), value }
}
