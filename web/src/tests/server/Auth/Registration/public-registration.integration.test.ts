import { afterAll, beforeAll, expect, test, vi } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import {
    DEFAULT_PUBLIC_PERMISSION_KEYS,
    PERMISSIONS,
} from '@/config/permissions.config.ts'
import * as schema from '@/db/schema.ts'

const client = new PGlite()
const db = drizzle(client, { schema })
vi.mock('@/db', () => ({ db }))
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishAuditLogCreatedService: async () => {},
    publishSystemSettingsUpdatedService: async () => {},
}))

const { updatePublicRegistrationService } =
    await import('@/server/Admin/SystemSettings/public-registration.service.ts')
const { SYSTEM_SETTINGS_ID } =
    await import('@/server/Admin/SystemSettings/settings.service.ts')
const { isPublicRegistrationEnabledService } =
    await import('@/server/Auth/Registration/policy.service.ts')
const { createRegistrationTokenService } =
    await import('@/server/Auth/Registration/token.service.ts')
const { verifyRegistrationService } =
    await import('@/server/Auth/Registration/verify.service.ts')

beforeAll(async () => {
    await migrate(db, { migrationsFolder: './web/drizzle' })
})

afterAll(async () => {
    await client.close()
})

test('applies a persisted registration switch to verification on a migrated database', async () => {
    const [actor] = await db
        .insert(schema.users)
        .values({
            accountType: 'staff',
            username: 'fixture-admin',
            email: 'fixture-admin@example.test',
            passwordHash: 'fixture-hash',
        })
        .returning({ id: schema.users.id })
    await db.insert(schema.staffAccounts).values({ userId: actor.id })
    const key = PERMISSIONS.ADMIN_SYSTEM_SETTINGS
    const [permission] = await db
        .insert(schema.permissions)
        .values({
            key,
            name: 'System settings',
            description: 'Test permission',
        })
        .returning({ id: schema.permissions.id })
    await db.insert(schema.permissions).values(
        DEFAULT_PUBLIC_PERMISSION_KEYS.map((permissionKey) => ({
            key: permissionKey,
            name: permissionKey,
            description: 'Test permission',
        })),
    )
    await db.insert(schema.staffUserPermissions).values({
        userId: actor.id,
        permissionId: permission.id,
    })
    await db.insert(schema.systemSettings).values({
        id: SYSTEM_SETTINGS_ID,
        companyName: 'Fixture Marketplace',
    })
    expect(await isPublicRegistrationEnabledService()).toBe(false)

    await updatePublicRegistrationService(true, actor.id)
    expect(await isPublicRegistrationEnabledService()).toBe(true)
    const { token, tokenHash, expiresAt } =
        await createRegistrationTokenService()
    const email = 'pending@example.test'
    await db.insert(schema.pendingRegistrations).values({
        username: 'pending-account',
        email,
        passwordHash: 'fixture-hash',
        termsVersion: '2026-11-16',
        acceptedAt: new Date(),
        tokenHash,
        expiresAt,
    })

    await updatePublicRegistrationService(false, actor.id)
    expect(await verifyRegistrationService({ token })).toEqual({
        success: false,
        error: 'registration.disabled',
    })
    expect(
        await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email)),
    ).toHaveLength(0)

    await updatePublicRegistrationService(true, actor.id)
    expect(await verifyRegistrationService({ token })).toEqual({
        success: true,
    })
    expect(
        await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email)),
    ).toHaveLength(1)
})
