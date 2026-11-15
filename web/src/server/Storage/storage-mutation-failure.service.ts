import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'
import { CoreCommandError } from '@/server/Core/error.ts'

export function hasUncertainStorageMutationFailureService(
    error: unknown,
): boolean {
    const pending: unknown[] = [error]
    const seen = new Set<object>()
    let visited = 0
    try {
        while (pending.length > 0) {
            visited += 1
            if (visited > config.maxErrorNodes) return true
            const current = pending.pop()
            if (
                (typeof current !== 'object' || current === null) &&
                typeof current !== 'function'
            )
                continue
            if (seen.has(current)) return true
            seen.add(current)
            if (current instanceof RestoreRollbackError) return true
            if (current instanceof CoreCommandError && current.isUncertain)
                return true
            const cause = Object.getOwnPropertyDescriptor(current, 'cause')
            if (cause) {
                if (!('value' in cause)) return true
                pending.push(cause.value)
            }
            if (current instanceof AggregateError) {
                const errors = Object.getOwnPropertyDescriptor(
                    current,
                    'errors',
                )
                if (
                    !errors ||
                    !('value' in errors) ||
                    !Array.isArray(errors.value)
                )
                    return true
                if (errors.value.length + pending.length > config.maxErrorNodes)
                    return true
                pending.push(...errors.value)
            }
        }
        return false
    } catch {
        return true
    }
}
