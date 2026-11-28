import { and, eq } from 'drizzle-orm'
import { users } from '@/db/schema.ts'

/** Deleted or deactivated accounts never appear in public profile data. */
export const visibleAccount = and(
    eq(users.isDeleted, false),
    eq(users.isActive, true),
)
