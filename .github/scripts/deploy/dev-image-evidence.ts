import { runToolingSync } from '../native-tools.ts'
import type {
    DevAssessment,
    DevCandidate,
    DevImageActual,
    DevImageContext,
    DevImageIdentity,
    DevPublication,
} from './Types/dev-image.ts'

export function devImageIdentity(context: DevImageContext): DevImageIdentity {
    return runToolingSync('oci-identity', context)
}

export function verifyDevLoadedImage(
    config: unknown,
    inspected: unknown,
): string {
    return runToolingSync('oci-loaded-evidence', { config, inspected })
}

export function createDevCandidate(
    identity: DevImageIdentity,
    actual: DevImageActual,
): DevCandidate {
    return runToolingSync('oci-candidate-evidence', { identity, actual })
}

export function validateDevCandidate(
    candidate: unknown,
    identity: DevImageIdentity,
    actual: DevImageActual,
): DevCandidate {
    return runToolingSync('oci-verify-candidate-evidence', {
        candidate,
        identity,
        actual,
    })
}

export function createDevAssessment(
    candidate: DevCandidate,
    timestamp: string,
): DevAssessment {
    return runToolingSync('oci-assessment-evidence', { candidate, timestamp })
}

export function createDevPublication(
    candidate: DevCandidate,
    remote: { immutable: string; dev: string },
    timestamp: string,
): DevPublication {
    return runToolingSync('oci-publication-evidence', {
        candidate,
        remote,
        timestamp,
    })
}
