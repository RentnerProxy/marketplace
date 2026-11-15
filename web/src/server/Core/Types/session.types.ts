export type CoreSession = {
    request: <TResult>(
        request: Record<string, unknown>,
        validateResult: (value: unknown) => TResult,
    ) => Promise<TResult>
    close: (
        request: Record<string, unknown>,
        validateResult: (value: unknown) => unknown,
    ) => Promise<void>
    abort: () => Promise<void>
}

export type CoreSessionOptions = {
    validateReady: (value: unknown) => unknown
    signal?: AbortSignal
    timeoutMs?: number
}
