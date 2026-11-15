export type StorageMutationScopeLease = {
    kind: 'shared' | 'exclusive'
    active: boolean
    uncertain: boolean
}

export type StorageMutationScope = {
    lease: StorageMutationScopeLease
    phase: 'active' | 'draining' | 'closed'
    children: Set<Promise<unknown>>
}
