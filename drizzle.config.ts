import { defineConfig } from 'drizzle-kit'
import { PROJECT_CONFIG } from './web/src/config/app.config.ts'

const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
    out: './web/drizzle',
    schema: './web/src/db/schema.ts',
    dialect: 'postgresql',
    ...(databaseUrl
        ? {
              dbCredentials: {
                  url: databaseUrl,
              },
          }
        : {}),
    schemaFilter: [PROJECT_CONFIG.databaseSchema],
})
