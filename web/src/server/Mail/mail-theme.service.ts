import { eq } from 'drizzle-orm'
import { db } from '@/db/index.ts'
import { user_settings, users } from '@/db/schema.ts'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'
import type { MailTheme } from '@/lib/Mail/Types/mail-template.types.ts'
import { logWarn } from '@/server/Logging/logger.ts'

export async function getRecipientMailThemeService(
    recipient: string,
): Promise<MailTheme> {
    try {
        const rows = await db
            .select({
                themeMode: user_settings.themeMode,
                primaryColor: user_settings.primaryColor,
                fontFamily: user_settings.fontFamily,
                fontSize: user_settings.fontSize,
            })
            .from(users)
            .leftJoin(user_settings, eq(user_settings.userId, users.id))
            .where(eq(users.email, recipient.trim().toLowerCase()))
            .limit(1)

        return createMailTheme(rows.at(0))
    } catch {
        // Darstellungseinstellungen dürfen Sicherheitsmails nicht verhindern.
        logWarn('mail.theme.fallback')
        return createMailTheme()
    }
}
