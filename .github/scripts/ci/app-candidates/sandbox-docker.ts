import { randomUUID } from 'node:crypto'
import type { AppManifest } from '@rentnerproxy/app-contracts'
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

interface SandboxOptions {
    target: AppManifest['target']
    network?: string
    user?: string
    memoryMiB: number
    processLimit: number
    mounts: string[]
    command: string[]
}

interface SandboxLifecycle {
    create(name: string, options: SandboxOptions): Promise<unknown>
    remove(name: string): Promise<unknown>
}

const dockerLifecycle: SandboxLifecycle = {
    create(name, options) {
        return runAppPipeline('sandbox-create', {
            name,
            config: { image: applianceImage, ...options },
        })
    },
    remove(name) {
        return docker(['rm', '--force', '--volumes', name])
    },
}

export async function withSandbox<T>(
    options: SandboxOptions,
    run: (name: string) => Promise<T>,
    lifecycle = dockerLifecycle,
) {
    const name = 'marketplace-candidate-' + randomUUID()
    let result: { value: T } | { error: unknown }
    try {
        await lifecycle.create(name, options)
        result = { value: await run(name) }
    } catch (error) {
        result = { error }
    }

    try {
        await lifecycle.remove(name)
    } catch {
        const message = `Candidate sandbox cleanup failed for ${name}.`
        if ('value' in result) throw new Error(message)
        console.warn(message)
    }

    if ('error' in result) throw result.error
    return result.value
}
