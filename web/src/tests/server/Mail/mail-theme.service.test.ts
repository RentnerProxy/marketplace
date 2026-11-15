import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { user_settings, users } from '@/db/schema.ts'
import { createMailTheme } from '@/lib/Mail/mailTheme.ts'
import type { MailThemeInput } from '@/lib/Mail/Types/mail-template.types.ts'

const limit = vi.fn(async function (_count: number): Promise<MailThemeInput[]> {
    return []
})
const where = vi.fn(function (_condition: unknown) {
    return { limit }
})
const leftJoin = vi.fn(function (_table: unknown, _condition: unknown) {
    return { where }
})
const from = vi.fn(function (_table: unknown) {
    return { leftJoin }
})
const select = vi.fn(function (_fields: unknown) {
    return { from }
})
const logWarn = vi.fn(function (_event: string) {})

vi.mock('@/db/index.ts', () => ({ db: { select } }))
vi.mock('@/server/Logging/logger.ts', () => ({ logWarn }))
const { getRecipientMailThemeService } =
    await import('@/server/Mail/mail-theme.service.ts')

beforeEach(function () {
    vi.clearAllMocks()
    limit.mockResolvedValue([])
})

describe('Design-Einstellungen des Mail-Empfängers', function () {
    it('liest ausschließlich die Darstellung des tatsächlichen Empfängers', async function () {
        const settings = {
            themeMode: 'light',
            primaryColor: '#059669',
            fontFamily: 'mono',
            fontSize: 17,
        }
        limit.mockResolvedValue([settings])

        expect(
            await getRecipientMailThemeService(' Recipient@Example.Test '),
        ).toEqual(createMailTheme(settings))
        expect(select).toHaveBeenCalledWith({
            themeMode: user_settings.themeMode,
            primaryColor: user_settings.primaryColor,
            fontFamily: user_settings.fontFamily,
            fontSize: user_settings.fontSize,
        })
        expect(from).toHaveBeenCalledWith(users)
        expect(leftJoin.mock.calls[0]?.[0]).toBe(user_settings)
        expect(limit).toHaveBeenCalledWith(1)
        const condition = where.mock.calls[0]?.[0]
        if (!(condition instanceof SQL))
            throw new Error('Empfängerfilter fehlt.')
        expect(new PgDialect().sqlToQuery(condition).params).toEqual([
            'recipient@example.test',
        ])
        expect(logWarn).not.toHaveBeenCalled()
    })

    it('verwendet ohne Benutzer oder Einstellungen das Standarddesign', async function () {
        expect(await getRecipientMailThemeService('new@example.test')).toEqual(
            createMailTheme(),
        )
        limit.mockResolvedValue([
            {
                themeMode: null,
                primaryColor: null,
                fontFamily: null,
                fontSize: null,
            },
        ])
        expect(await getRecipientMailThemeService('new@example.test')).toEqual(
            createMailTheme(),
        )
    })

    it('verhindert bei einem Lesefehler keine Mail und protokolliert keine Empfängerdaten', async function () {
        limit.mockRejectedValueOnce(
            new Error('synthetic recipient@example.test credential'),
        )

        expect(
            await getRecipientMailThemeService('recipient@example.test'),
        ).toEqual(createMailTheme())
        expect(logWarn).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith('mail.theme.fallback')
    })
})
