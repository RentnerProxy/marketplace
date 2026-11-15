import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { WriteAuditLogInput } from '@/lib/AuditLogs/Types/audit.types.ts'

export type UserSettingsAuditEvent = Pick<
    WriteAuditLogInput,
    'action' | 'message'
>

type UserSettingsMutationResult<T> =
    | { changed: false; value: T }
    | {
          changed: true
          value: T
          oldValues?: Record<string, unknown> | null
          newValues?: Record<string, unknown> | null
      }

export type UserSettingsMutation<T> = (
    transaction: DatabaseTransaction,
) => Promise<UserSettingsMutationResult<T>>
