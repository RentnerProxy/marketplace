import { describe, expect, it, vi } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
    registrationInputSchema,
    verifyRegistrationInputSchema,
} from '@/features/Auth/Register/validation.ts'
import {
    createRegistrationLinkService,
    createRegistrationTokenService,
} from '@/server/Auth/Registration/token.service.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { pendingRegistrations } from '@/db/Schema/registration.ts'
import { createPublicAccountInTransactionService } from '@/server/Auth/Registration/account.service.ts'
import { userPermissions } from '@/db/Schema/permissions.ts'
import { user_profiles, users } from '@/db/Schema/users.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

vi.mock('@/lib/AuditLogs/auditLogs.ts', () => ({
    prepareAuditContextService: () => ({ actorUserId: null }),
    writeAuditLogInTransactionService: vi.fn(async () => ({
        id: 'audit',
        createdAt: new Date(),
    })),
}))

function transactionFixture(selections: Array<Array<{ id: string }>>) {
    const inserts: Array<{ table: unknown; values: unknown }> = []
    const queries: SQL[] = []
    const order: string[] = []
    const execute = vi.fn(async (query: SQL) => {
        queries.push(query)
        order.push('lock')
    })
    const transaction = {
        execute,
        select: () => ({
            from: () => ({
                where: (query: SQL) => ({
                    limit: async () => {
                        queries.push(query)
                        order.push('select')
                        return selections.shift() ?? []
                    },
                }),
            }),
        }),
        insert: (table: unknown) => ({
            values: (values: unknown) => {
                inserts.push({ table, values })
                return { returning: async () => [{ id: 'new-user' }] }
            },
        }),
    } as unknown as DatabaseTransaction
    return { transaction, inserts, execute, queries, order }
}

describe('Public registration', () => {
    it('normalizes email and rejects unsafe usernames, missing terms and short passwords', () => {
        const input = {
            username: 'new-user',
            email: ' Person@Example.test ',
            password: 'strong-password',
            acceptTerms: true,
        }
        expect(registrationInputSchema.parse(input).email).toBe(
            'person@example.test',
        )
        for (const invalid of [
            { username: 'bad name' },
            { password: 'abc' },
            { acceptTerms: false },
        ]) {
            expect(
                registrationInputSchema.safeParse({ ...input, ...invalid })
                    .success,
            ).toBe(false)
        }
    })

    it('creates random hashed tokens and fragment-only verification links', async () => {
        const first = await createRegistrationTokenService()
        const second = await createRegistrationTokenService()
        expect(verifyRegistrationInputSchema.safeParse(first).success).toBe(
            true,
        )
        expect(first.token).not.toBe(second.token)
        expect(first.tokenHash).toBe(await createTokenHash(first.token))
        expect(first.tokenHash).not.toBe(first.token)
        const link = new URL(
            createRegistrationLinkService(
                'https://app.example.test/elsewhere?secret=no',
                first.token,
            ),
        )
        expect(link.pathname).toBe('/register')
        expect(link.search).toBe('')
        expect(link.hash).toBe(`#verify=${first.token}`)
        expect(pendingRegistrations.tokenHash.notNull).toBe(true)
        expect('token' in pendingRegistrations).toBe(false)
    })

    it('cannot become the bootstrap account', async () => {
        const fixture = transactionFixture([[]])
        await expect(
            createPublicAccountInTransactionService(fixture.transaction, {
                username: 'person',
                email: 'person@example.test',
                passwordHash: 'hashed',
            }),
        ).rejects.toThrow('bootstrap')
        expect(fixture.execute).toHaveBeenCalledTimes(1)
        expect(fixture.inserts).toHaveLength(0)
    })

    it('does not create an account for duplicate identifiers', async () => {
        const fixture = transactionFixture([
            [{ id: 'admin' }],
            [{ id: 'existing' }],
        ])
        expect(
            await createPublicAccountInTransactionService(fixture.transaction, {
                username: 'Person',
                email: 'Person@Example.test',
                passwordHash: 'hashed',
            }),
        ).toBeNull()
        expect(fixture.inserts).toHaveLength(0)
        expect(fixture.order).toEqual(['lock', 'select', 'select'])
        const dialect = new PgDialect()
        const queries = fixture.queries.map((query) =>
            dialect.sqlToQuery(query),
        )
        expect(queries[0]).toMatchObject({
            sql: 'select pg_advisory_xact_lock(7421906)',
            params: [],
        })
        expect(queries[2].sql).toContain(
            'lower("marketplace"."users"."username")',
        )
        expect(queries[2].sql).toContain('lower("marketplace"."users"."email")')
        expect(queries[2].params).toEqual([
            false,
            'person',
            'person@example.test',
        ])
    })

    it('grants only the dashboard permission and adds profile and verified identity atomically', async () => {
        const fixture = transactionFixture([
            [{ id: 'admin' }],
            [],
            [],
            [{ id: 'dashboard-permission' }],
        ])
        const result = await createPublicAccountInTransactionService(
            fixture.transaction,
            {
                username: 'person',
                email: 'person@example.test',
                passwordHash: 'hashed',
                provider: 'google',
                subject: 'provider-subject',
            },
        )
        expect(result?.userId).toBe('new-user')
        expect(fixture.inserts.map((entry) => entry.table)).toEqual([
            users,
            user_profiles,
            userPermissions,
            socialAccounts,
        ])
        expect(fixture.inserts[2]?.values).toEqual({
            userId: 'new-user',
            permissionId: 'dashboard-permission',
        })
    })

    it('refuses registration when least-privilege permission is unavailable', async () => {
        const fixture = transactionFixture([[{ id: 'admin' }], [], []])
        await expect(
            createPublicAccountInTransactionService(fixture.transaction, {
                username: 'person',
                email: 'person@example.test',
                passwordHash: 'hashed',
            }),
        ).rejects.toThrow('permission')
        expect(fixture.inserts).toHaveLength(0)
    })
})
