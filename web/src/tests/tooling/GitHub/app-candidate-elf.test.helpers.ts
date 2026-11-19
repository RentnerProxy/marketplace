import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElfLinkage } from '../../../../../.github/scripts/ci/app-candidates/elf-appliance.ts'
import { runAppPipelineSync } from '../../../../../.github/scripts/native-tools.ts'
import type { AppManifest } from '../../../../../contracts/v1/index.ts'

export function inspectCandidateLinkage(
    binary: Uint8Array,
    target: AppManifest['target'],
) {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-elf-'))
    try {
        const inputPath = join(directory, 'app')
        writeFileSync(inputPath, binary)
        return runAppPipelineSync<ElfLinkage | null>('inspect-elf', {
            inputPath,
            target,
        })
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}
