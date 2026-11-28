import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { AppManifest } from '@rentnerproxy/app-contracts'
import { runAppPipeline } from '../../native-tools.ts'
import { applianceLibraryVersions, type ElfLinkage } from './elf-appliance.ts'

interface CandidateExpectation {
    source: AppManifest['source']
    target: AppManifest['target']
}

interface ValidatedPackage {
    manifest: AppManifest
    manifestSha256: string
}

interface StagedPackage extends ValidatedPackage {
    linkage: (ElfLinkage & { path: string })[]
}

export async function validateCandidatePackage(
    archivePath: string,
    packageDirectory: string,
    expected: CandidateExpectation,
): Promise<ValidatedPackage> {
    const outputDirectory = resolve(packageDirectory)
    const work = await mkdtemp(
        join(dirname(outputDirectory), '.candidate-package-'),
    )
    const stagingPath = join(work, 'package')
    try {
        const { manifest, manifestSha256, linkage } =
            await runAppPipeline<StagedPackage>('validate-package', {
                archivePath,
                outputDirectory: stagingPath,
                source: expected.source,
                target: expected.target,
            })
        if (linkage.length > 0) {
            const available = await applianceLibraryVersions(
                expected.target,
                linkage,
            )
            await runAppPipeline('verify-package-abi', {
                linkage,
                applianceLibraryVersions: available,
            })
        }
        await runAppPipeline('promote-package', {
            stagingPath,
            outputDirectory,
        })
        return { manifest, manifestSha256 }
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}
