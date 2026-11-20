import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../AuditLogs/read-query.test.helpers.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

const read = createReadDb()
const insertChain = {
    values: vi.fn((_value: unknown) => insertChain),
    onConflictDoNothing: vi.fn(async () => undefined),
}
const insert = vi.fn((_table: unknown) => insertChain)
const database = { ...read.db, insert }
vi.mock('@/db', () => ({
    db: {
        ...database,
        transaction: async (run: (tx: typeof database) => Promise<unknown>) =>
            run(database),
    },
}))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({ systemSettings: table('settings', ['id']) }))
const {
    DEFAULT_COMPANY_NAME,
    SYSTEM_SETTINGS_ID,
    getOrCreateSystemSettingsService,
    getOrCreateSystemSettingsForUpdateService,
} = await import('@/server/Admin/SystemSettings/settings.service.ts')
const base = {
    logoUpdatedAt: null,
    isPublicRegistrationEnabled: false,
    isMaintenanceModeEnabled: false,
    maintenanceStartsAt: null,
    updatedAt: new Date('2026-01-01T12:00:00Z'),
}

beforeEach(() => {
    vi.clearAllMocks()
    read.results.length = 0
    read.queries.length = 0
})

describe('system settings initialization', () => {
    it('returns the existing configuration without inserting another row', async () => {
        const existing = {
            ...base,
            id: SYSTEM_SETTINGS_ID,
            companyName: 'Configured',
        }
        read.results.push([existing])
        expect(await getOrCreateSystemSettingsService()).toBe(existing)
        expect(insert).not.toHaveBeenCalled()
    })

    it('creates the default singleton configuration when no row exists', async () => {
        const created = {
            ...base,
            id: SYSTEM_SETTINGS_ID,
            companyName: DEFAULT_COMPANY_NAME,
        }
        read.results.push([], [created])
        expect(await getOrCreateSystemSettingsService()).toBe(created)
        expect(insertChain.values).toHaveBeenCalledWith({
            id: SYSTEM_SETTINGS_ID,
            companyName: DEFAULT_COMPANY_NAME,
        })
        expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(1)
        expect(read.queries[1]?.for).toHaveBeenCalledWith('update')
    })

    it('ensures a singleton exists before acquiring its update lock in the supplied transaction', async () => {
        const existing = {
            ...base,
            id: SYSTEM_SETTINGS_ID,
            companyName: 'Configured',
        }
        read.results.push([existing])
        expect(
            await getOrCreateSystemSettingsForUpdateService(
                database as unknown as DatabaseTransaction,
            ),
        ).toBe(existing)
        expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(1)
        expect(read.queries[0]?.where).toHaveBeenCalledWith({
            op: 'eq',
            left: 'settings.id',
            right: SYSTEM_SETTINGS_ID,
        })
        expect(read.queries[0]?.for).toHaveBeenCalledWith('update')
    })

    it('fails explicitly if the singleton is unavailable after initialization', async () => {
        await expect(
            getOrCreateSystemSettingsForUpdateService(
                database as unknown as DatabaseTransaction,
            ),
        ).rejects.toThrow('System settings row is unavailable')
    })
})
