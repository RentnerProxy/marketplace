import type { AppManifest, Candidate } from '@rentnerproxy/app-contracts'
import type {
    AppSource,
    AppTarget,
    BuildIdentity,
    Purpose,
    TargetExpectation,
    TargetRecord,
} from '../../../../web/src/lib/Marketplace/candidateEvidence.ts'
import { runAppPipeline } from '../../native-tools.ts'

export type {
    BuildIdentity,
    Purpose,
} from '../../../../web/src/lib/Marketplace/candidateEvidence.ts'

interface SealTargetOptions {
    outputDirectory: string
    archivePath: string
    sbomPath: string
    manifest: AppManifest
    manifestSha256: string
    build: BuildIdentity
    purpose: Purpose
    applianceImage: string
}

// Invoke only after the trusted job validates, scans and smoke-tests these bytes.
export function sealTarget(options: SealTargetOptions) {
    return runAppPipeline<TargetRecord>('evidence-seal-target', options)
}

interface SealCandidateOptions extends TargetExpectation {
    outputDirectory: string
    targetDirectories: Record<AppTarget, string>
    publisherName: string
}

export function sealCandidate(options: SealCandidateOptions) {
    return runAppPipeline<Candidate>('evidence-seal-candidate', options)
}

export interface CandidateHandoffExpectation {
    source: AppSource
    build: BuildIdentity
    artifact: {
        id: string
        sha256: string
        expiresAt: string
        expired: boolean
    }
    downloadedArtifact: { id: string; sha256: string }
    now: Date
}

// The protected caller authenticates and extracts the exact GitHub artifact first.
export function verifyCandidateHandoff(
    directory: string,
    expected: CandidateHandoffExpectation,
) {
    return runAppPipeline<Candidate>('evidence-verify-handoff', {
        directory,
        ...expected,
        now: expected.now.getTime(),
    })
}
