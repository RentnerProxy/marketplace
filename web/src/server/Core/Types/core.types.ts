export type CoreBinary = 'archive' | 'storage'

export type CoreCommandOptions<TResult = unknown> = {
    signal?: AbortSignal
    onProgress?: (progress: unknown) => void | Promise<void>
    timeoutMs?: number
    environment?: Record<string, string>
    binaryInput?: Uint8Array
    validateResult?: (result: unknown) => TResult
}

export type CoreRuntimeHealth = {
    status: 'running'
    version: string
    pid: number
    uptimeSeconds: number
}
