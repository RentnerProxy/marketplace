import { randomUUID } from 'node:crypto'
import type { AppManifest } from '../../../../contracts/v1/index.ts'
import { runAppPipeline, runAppPipelineSync } from '../../native-tools.ts'

export const applianceImage =
    'ghcr.io/rentnerproxy/platform@sha256:6a9ecb2330c20f366590f4c6c1c32441104a44c8435d7858cbef4d9496e07b46'
export const bunVersion = '1.4.4'
export const appUser = '21001:21004'

export function bindReadOnly(source: string, destination: string) {
    return runAppPipelineSync<string[]>('sandbox-mount', {
        source,
        destination,
    })
}

export function docker(args: string[], timeout = 20_000) {
    return runAppPipeline<string>('sandbox-docker', { args, timeout })
}

export function attach(
    args: string[],
    options: {
        operation: string
        timeout: number
        input?: string
        archive?: { path: string; maxBytes: number }
    },
) {
    return runAppPipeline<null>('sandbox-attach', { args, ...options })
}

export async function withSandbox<T>(
    options: {
        target: AppManifest['target']
        network?: string
        user?: string
        memoryMiB: number
        processLimit: number
        mounts: string[]
        command: string[]
    },
    run: (name: string) => Promise<T>,
) {
    const name = 'marketplace-candidate-' + randomUUID()
    try {
        await runAppPipeline('sandbox-create', {
            name,
            config: { image: applianceImage, ...options },
        })
        return await run(name)
    } finally {
        await docker(['rm', '--force', '--volumes', name])
    }
}
