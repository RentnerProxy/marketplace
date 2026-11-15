import type { MutationCache, QueryClient } from '@tanstack/react-query'

const observedCaches = new WeakSet<MutationCache>()

export function installAuthSecretMutationCleanup(
    queryClient: QueryClient,
): void {
    const cache = queryClient.getMutationCache()
    if (observedCaches.has(cache)) return
    observedCaches.add(cache)

    cache.subscribe(function (event) {
        if (
            event.type !== 'updated' ||
            (event.action.type !== 'success' &&
                event.action.type !== 'error') ||
            event.mutation.meta?.discardAuthSecretsAfterSettled !== true
        )
            return
        event.mutation.destroy()
        cache.remove(event.mutation)
    })
}
