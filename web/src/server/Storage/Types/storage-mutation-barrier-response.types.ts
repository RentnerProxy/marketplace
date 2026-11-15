export type StorageMutationResponseResult = { response: Response }

export type StorageMutationResponseOptions = {
    signal?: AbortSignal
}

export type StorageMutationResponseSourceState =
    { state: 'closed' } | { state: 'errored'; error: unknown }
