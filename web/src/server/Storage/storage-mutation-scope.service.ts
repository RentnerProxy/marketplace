import { hasUncertainStorageMutationFailureService } from './storage-mutation-failure.service.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import type {
    StorageMutationScope,
    StorageMutationScopeLease,
} from './Types/storage-mutation-scope.types.ts'

const context = new AsyncLocalStorage<StorageMutationScope>()

export function getActiveStorageMutationScopeService(): StorageMutationScope | null {
    const scope = context.getStore()
    return scope?.phase === 'active' && scope.lease.active ? scope : null
}

export function runInStorageMutationScopeContextService<TResult>(
    scope: StorageMutationScope,
    operation: () => TResult,
): TResult {
    if (scope.phase !== 'active' || !scope.lease.active)
        throw new Error('Storage scope is no longer active.')
    return context.run(scope, operation)
}

export function markStorageMutationScopeUncertainService(
    scope: StorageMutationScope,
): void {
    scope.lease.uncertain = true
}

export function runInStorageMutationScopeService<TResult>(
    lease: StorageMutationScopeLease,
    operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
    const parent = getActiveStorageMutationScopeService()
    const scope: StorageMutationScope = {
        lease,
        phase: 'active',
        children: new Set(),
    }
    const task = Promise.resolve().then(async function () {
        try {
            return await context.run(scope, operation)
        } finally {
            scope.phase = 'draining'
            try {
                await Promise.allSettled(scope.children)
            } finally {
                scope.phase = 'closed'
            }
        }
    })
    if (parent?.lease === lease) {
        parent.children.add(task)
        void task.then(
            () => parent.children.delete(task),
            (error: unknown) => {
                if (hasUncertainStorageMutationFailureService(error))
                    lease.uncertain = true
                parent.children.delete(task)
                return undefined
            },
        )
    }
    return task
}
