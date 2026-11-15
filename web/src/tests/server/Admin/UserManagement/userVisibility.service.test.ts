import { describe, expect, it, vi } from 'bun:test'
import { hasOtherVisibleUserInTransaction } from '@/server/Admin/UserManagement/userVisibility.service.ts'

const schemaMock = (function () {
    return {
        users: {
            id: 'users.id',
            isDeleted: 'users.isDeleted',
        },
    }
})()

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return { type: 'and', conditions }
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'eq', left, right }
        }),
        ne: vi.fn(function (left: unknown, right: unknown) {
            return { type: 'ne', left, right }
        }),
    }
})

function createTransaction(result: Array<{ id: string }>) {
    const chain = {
        from: vi.fn(function () {
            return chain
        }),
        where: vi.fn(function () {
            return chain
        }),
        limit: vi.fn(async function () {
            return result
        }),
    }

    return {
        select: vi.fn(function () {
            return chain
        }),
    }
}

describe('UserManagement Benutzer-Sichtbarkeit', function () {
    it('erkennt andere sichtbare Benutzer', async function () {
        await expect(
            hasOtherVisibleUserInTransaction(
                createTransaction([{ id: 'user-2' }]) as never,
                'user-1',
            ),
        ).resolves.toBe(true)
        await expect(
            hasOtherVisibleUserInTransaction(
                createTransaction([]) as never,
                'user-1',
            ),
        ).resolves.toBe(false)
    })
})
