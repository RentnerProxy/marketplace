import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'

export type RestoreStatusResult = {
    state: {
        restoreStatus: RestoreStatus | null
        isLoading: boolean
        isError: boolean
    }
}
