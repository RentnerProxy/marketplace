import type { db } from '@/db'

export type Database = typeof db
export type DatabaseTransaction = Parameters<
    Parameters<Database['transaction']>[0]
>[0]
export type DatabaseReader = Pick<Database, 'select'>
