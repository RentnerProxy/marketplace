import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export const DEFAULT_COMPANY_NAME: string = PROJECT_CONFIG.defaultName
export const SYSTEM_SETTINGS_ID = 'default'

export async function getOrCreateSystemSettingsService() {
    const [existing] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
        .limit(1)
    return existing ?? db.transaction(getOrCreateSystemSettingsForUpdateService)
}

export async function getOrCreateSystemSettingsForUpdateService(
    transaction: DatabaseTransaction,
) {
    await transaction
        .insert(systemSettings)
        .values({ id: SYSTEM_SETTINGS_ID, companyName: DEFAULT_COMPANY_NAME })
        .onConflictDoNothing()
    const rows = await transaction
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
        .limit(1)
        .for('update')
    const settings = rows.at(0)
    if (!settings) throw new Error('System settings row is unavailable')
    return settings
}
