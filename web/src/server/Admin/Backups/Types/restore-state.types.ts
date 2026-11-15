import type { restoreStateSchema } from '@/server/Admin/Backups/restore-state.schema.ts'
import type { z } from 'zod'
export type RestoreState = z.infer<typeof restoreStateSchema>

export type WriteRestoreStateInput = Omit<
    RestoreState,
    'version' | 'updatedAt'
> & {
    updatedAt?: string
}
