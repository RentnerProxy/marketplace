import { createHash } from 'node:crypto'
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
    checkManifestCompatibility,
    contractVersion,
    type AppManifest,
} from '../../../../contracts/v1/index.ts'
import {
    openApiDocument,
    packageJson,
    packageText,
    requiredFile,
    verifyDocumentReferences,
} from './archive-documents.ts'
import { readCandidateArchive, type ArchiveEntry } from './archive-ustar.ts'
import { inspectCandidateElf, verifyReadelf } from './elf.ts'

interface CandidateExpectation {
    source: AppManifest['source']
    target: AppManifest['target']
}

function validatePackageFiles(
    entries: Map<string, ArchiveEntry>,
    manifest: AppManifest,
) {
    const license = packageText(entries, 'LICENSE')
    if (
        /^(?:NOASSERTION|NONE|UNLICENSED)$/i.test(manifest.display.license) ||
        /^(?:NOASSERTION|NONE|UNLICENSED)$/i.test(license.trim())
    ) {
        throw new Error(
            'Candidate requires declared license metadata and a package license',
        )
    }
    requiredFile(entries, manifest.entrypoint)
    if (manifest.ui) packageText(entries, manifest.ui.entrypoint)

    const api = packageJson(entries, manifest.api)
    openApiDocument(api)
    const documents = new Map<string, unknown>([[manifest.api, api]])
    if (manifest.configSchema) {
        const schema = packageJson(entries, manifest.configSchema)
        if (
            typeof schema !== 'boolean' &&
            (typeof schema !== 'object' ||
                schema === null ||
                Array.isArray(schema))
        ) {
            throw new Error('Invalid candidate JSON configuration schema')
        }
        documents.set(manifest.configSchema, schema)
    }
    verifyDocumentReferences(entries, documents)
    for (const migration of manifest.data?.migrations ?? []) {
        if (migration.path.endsWith('.json'))
            packageJson(entries, migration.path)
        else packageText(entries, migration.path)
    }
}

async function assertUnused(path: string) {
    try {
        await lstat(path)
    } catch (error) {
        if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            return
        throw error
    }
    throw new Error('Candidate package output directory already exists')
}

async function stagePackage(
    entries: Map<string, ArchiveEntry>,
    neededByExecutable: Map<string, string[]>,
    packageDirectory: string,
) {
    const destination = resolve(packageDirectory)
    await assertUnused(destination)
    const staging = await mkdtemp(
        join(dirname(destination), '.candidate-package-'),
    )
    try {
        // Stage only verified paths in a private directory. One-at-a-time writes
        // keep open descriptors bounded even for the largest admitted archive.
        for (const entry of entries.values()) {
            const path = join(staging, entry.path)
            // oxlint-disable-next-line no-await-in-loop
            await mkdir(entry.directory ? path : dirname(path), {
                recursive: true,
                mode: 0o755,
            })
            if (entry.directory) continue
            // oxlint-disable-next-line no-await-in-loop
            await writeFile(path, entry.bytes, {
                flag: 'wx',
                mode: entry.executable ? 0o755 : 0o644,
            })
            const needed = neededByExecutable.get(entry.path)
            // oxlint-disable-next-line no-await-in-loop
            if (needed) await verifyReadelf(path, needed)
        }
        await chmod(staging, 0o755)
        await rename(staging, destination)
    } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
    }
}

export async function validateCandidatePackage(
    tarPath: string,
    packageDirectory: string,
    expected: CandidateExpectation,
): Promise<{ manifest: AppManifest; manifestSha256: string }> {
    const entries = await readCandidateArchive(tarPath)
    const manifest = checkManifestCompatibility(
        packageJson(entries, 'app.json'),
        {
            target: expected.target,
            runtimeProfile: 'rentnerproxy-linux-v1',
            platformApi: contractVersion,
            appProtocol: contractVersion,
            uiBridge: contractVersion,
            engineCapabilities: [
                'caddy.load-balancing.v1',
                'caddy.crowdsec.v1',
            ],
        },
    )
    if (
        manifest.source.repositoryId !== expected.source.repositoryId ||
        manifest.source.commit !== expected.source.commit
    ) {
        throw new Error(
            'Candidate package source identity does not match its exact checkout',
        )
    }
    validatePackageFiles(entries, manifest)

    const neededByExecutable = new Map<string, string[]>()
    let executables = 0
    for (const entry of entries.values()) {
        if (!entry.executable || entry.directory) continue
        if (++executables > 16)
            throw new Error('Candidate package has too many executables')
        const needed = inspectCandidateElf(entry.bytes, manifest.target)
        if (needed) neededByExecutable.set(entry.path, needed)
    }
    const manifestSha256 = createHash('sha256')
        .update(requiredFile(entries, 'app.json'))
        .digest('hex')
    await stagePackage(entries, neededByExecutable, packageDirectory)
    return { manifest, manifestSha256 }
}
