import { pgSchema } from 'drizzle-orm/pg-core'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export const appSchema = pgSchema(PROJECT_CONFIG.databaseSchema)
