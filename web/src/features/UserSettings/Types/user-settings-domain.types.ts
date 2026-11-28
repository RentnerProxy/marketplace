import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export type AuthenticatedSessionUser = NonNullable<
    AuthenticatedSessionQueryData['user']
>
