import type { twoFactorAuth } from '@/db/schema.ts'

export type TotpFactor = Pick<
    typeof twoFactorAuth.$inferSelect,
    'id' | 'userId' | 'secret' | 'verified'
>
