import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    getActiveCurrentSessionUser,
    getCurrentSessionUserId,
    getCurrentUserAccess,
    getCurrentUserSettingsSession,
} from '@/server/Auth/currentSession.ts'
import { validateSessionService } from '@/server/Auth/validate.service.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { sessionConfig, SESSION_COOKIE_NAME } from '@/config/session.config.ts'

const STARTED_AT = Date.parse('2026-09-06T02:00:00.000Z')
const entropy = Buffer.alloc(32, 7).toString('base64url')
const schema = {
    users: {
        id: 'users.id',
        accountType: 'users.accountType',
        emailVerifiedAt: 'users.emailVerifiedAt',
    },
    sessions: { id: 'sessions.id', userId: 'sessions.userId' },
    user_profiles: { userId: 'user_profiles.userId' },
    user_settings: { userId: 'user_settings.userId' },
    accountPermissions: {
        userId: 'accountPermissions.userId',
        permissionId: 'accountPermissions.permissionId',
    },
    permissions: { id: 'permissions.id', key: 'permissions.key' },
}
const state = {
    nowMs: STARTED_AT,
    issuedAtMs: STARTED_AT - 5 * 60_000,
    cookie: undefined as string | undefined,
    sessionHash: '',
    conditions: [] as Array<unknown>,
    exists: true,
    expiresAt: new Date(STARTED_AT + sessionConfig.idleDurationMs),
    user: {
        id: 'user-1',
        username: 'synthetic',
        email: 'synthetic@example.test',
        accountType: 'public',
        emailVerifiedAt: new Date(STARTED_AT - 60_000),
        passwordHash: 'must-not-be-exposed',
        isActive: true,
        isDeleted: false,
        isTwoFactorEnabled: false,
        createdAt: new Date(STARTED_AT - 60_000),
        createdByUserId: null,
    },
    permissions: ['user.synthetic'],
    beforeRead: null as (() => Promise<void>) | null,
    beforePermissions: null as (() => Promise<void>) | null,
    beforeMaintenance: null as (() => Promise<void>) | null,
}
const services = {
    getCookie: vi.fn((_name: string) => state.cookie),
    setCookie: vi.fn(),
    deleteCookie: vi.fn((_name: string) => {
        state.cookie = undefined
    }),
    permissions: vi.fn(async () => {
        const result = state.permissions.slice()
        await state.beforePermissions?.()
        return result
    }),
    maintenance: vi.fn(async () => {
        await state.beforeMaintenance?.()
        return { isActive: false, isScheduled: false, startsAt: null }
    }),
}
const database = {
    select: vi.fn((selection: Record<string, unknown>) => {
        let selectedTable: unknown
        const chain = {
            from: (table: unknown) => {
                selectedTable = table
                return chain
            },
            innerJoin: () => chain,
            leftJoin: () => chain,
            where: vi.fn((condition: unknown) => {
                state.conditions.push(condition)
                if (selectedTable === schema.accountPermissions) {
                    return services
                        .permissions()
                        .then((keys) => keys.map((key) => ({ key })))
                }
                return chain
            }),
            limit: vi.fn(async () => {
                const flatRow: Record<string, unknown> = {
                    ...state.user,
                    userId: state.user.id,
                    sessionHash: state.sessionHash,
                    expiresAt: new Date(state.expiresAt),
                    customBackgroundDarkness: null,
                    fontFamily: 'inter',
                    fontSize: 16,
                    primaryColor: null,
                    themeMode: 'dark',
                }
                const snapshot = state.exists
                    ? [
                          selection.user === schema.users
                              ? {
                                    user: structuredClone(state.user),
                                    profile: null,
                                    settings: null,
                                    expiresAt: new Date(state.expiresAt),
                                }
                              : Object.fromEntries(
                                    Object.keys(selection).map((key) => [
                                        key,
                                        flatRow[key],
                                    ]),
                                ),
                      ]
                    : []
                await state.beforeRead?.()
                return snapshot
            }),
        }
        return chain
    }),
    insert: vi.fn(() => {
        throw new Error('Passive reader attempted insert')
    }),
    update: vi.fn(() => {
        throw new Error('Passive reader attempted update')
    }),
    delete: vi.fn(() => {
        throw new Error('Passive reader attempted delete')
    }),
    transaction: vi.fn(() => {
        throw new Error('Passive reader attempted transaction')
    }),
}
vi.mock('@tanstack/react-start/server', () => services)
vi.mock('drizzle-orm', () => ({
    eq: (left: unknown, right: unknown) => ({ left, right }),
}))
vi.mock('@/db', () => ({ db: database }))
vi.mock('@/db/schema.ts', () => schema)
vi.mock('@/lib/Permissions/userPermissions.ts', () => ({
    getUserPermissionKeys: services.permissions,
}))
vi.mock('@/lib/Permissions/permissions.ts', () => ({
    hasSuperUserPermission: (keys: Array<string>) => keys.includes('superuser'),
    hasPermission: (keys: Array<string>, key: string) => keys.includes(key),
}))
vi.mock('@/server/Maintenance/state.service.ts', () => ({
    getMaintenanceStateService: services.maintenance,
}))

const readers = [
    { name: 'user ID', read: getCurrentSessionUserId },
    { name: 'active user', read: getActiveCurrentSessionUser },
    { name: 'settings user', read: getCurrentUserSettingsSession },
]

beforeEach(async () => {
    vi.clearAllMocks()
    state.nowMs = STARTED_AT
    state.issuedAtMs = STARTED_AT - 5 * 60_000
    state.cookie = 's1.' + state.issuedAtMs + '.' + entropy
    state.sessionHash = await createTokenHash(state.cookie)
    state.conditions = []
    state.exists = true
    state.expiresAt = new Date(STARTED_AT + sessionConfig.idleDurationMs)
    state.user.isActive = true
    state.user.isDeleted = false
    state.permissions = ['user.synthetic']
    state.beforeRead = null
    state.beforePermissions = null
    state.beforeMaintenance = null
    vi.spyOn(Date, 'now').mockImplementation(() => state.nowMs)
})

afterEach(() => {
    expect(database.insert).not.toHaveBeenCalled()
    expect(database.update).not.toHaveBeenCalled()
    expect(database.delete).not.toHaveBeenCalled()
    expect(database.transaction).not.toHaveBeenCalled()
    expect(services.setCookie).not.toHaveBeenCalled()
    expect(services.deleteCookie).not.toHaveBeenCalled()
    vi.restoreAllMocks()
})

describe.each(readers)('passive $name lookup', ({ read }) => {
    it('authenticates only the hash of the complete versioned cookie', async () => {
        expect(await read()).not.toBeNull()
        expect(services.getCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME)
        expect(database.select).toHaveBeenCalledTimes(1)
        expect(state.conditions).toEqual([
            {
                left: schema.sessions.id,
                right: state.sessionHash,
            },
        ])
    })

    it.each([
        { name: 'missing', value: undefined },
        { name: 'legacy', value: '00000000-0000-4000-8000-000000000001' },
        { name: 'malformed', value: 's1.12.not-an-entropy-value' },
        {
            name: 'expired',
            value:
                's1.' +
                (STARTED_AT - sessionConfig.absoluteDurationMs) +
                '.' +
                entropy,
        },
        { name: 'future', value: 's1.' + (STARTED_AT + 1) + '.' + entropy },
    ])('rejects $name tokens before database access', async ({ value }) => {
        state.cookie = value
        expect(await read()).toBeNull()
        expect(database.select).not.toHaveBeenCalled()
    })

    it.each([
        'missing',
        'inactive',
        'deleted',
        'idle',
        'invalid date',
    ] as const)('rejects a %s database session', async (kind) => {
        if (kind === 'missing') state.exists = false
        if (kind === 'inactive') state.user.isActive = false
        if (kind === 'deleted') state.user.isDeleted = true
        if (kind === 'idle') state.expiresAt = new Date(state.nowMs)
        if (kind === 'invalid date') state.expiresAt = new Date(Number.NaN)
        expect(await read()).toBeNull()
    })

    it('checks idle expiry after the database await', async () => {
        state.expiresAt = new Date(state.nowMs + 1)
        state.beforeRead = async () => {
            state.nowMs += 1
        }
        expect(await read()).toBeNull()
    })

    it('checks absolute expiry after the database await', async () => {
        state.nowMs = state.issuedAtMs + sessionConfig.absoluteDurationMs - 1
        state.expiresAt = new Date(state.nowMs + 60_000)
        state.beforeRead = async () => {
            state.nowMs += 1
        }
        expect(await read()).toBeNull()
    })

    it('does not remove a concurrent extension or clear a newer login cookie after a stale read', async () => {
        state.expiresAt = new Date(state.nowMs + 1)
        const replacementCookie =
            's1.' +
            state.nowMs +
            '.' +
            Buffer.alloc(32, 8).toString('base64url')
        state.beforeRead = async () => {
            state.nowMs += 1
            state.expiresAt = new Date(
                state.nowMs + sessionConfig.idleDurationMs,
            )
            state.cookie = replacementCookie
        }
        expect(await read()).toBeNull()
        expect(state.cookie).toBe(replacementCookie)
        expect(state.expiresAt.getTime()).toBeGreaterThan(state.nowMs)
    })
})

describe('passive permission access', () => {
    it('returns current access without changing deadlines', async () => {
        expect(await getCurrentUserAccess()).toEqual({
            userId: 'user-1',
            permissionKeys: ['user.synthetic'],
            isSuperUser: false,
        })
    })

    it.each(['idle', 'absolute'] as const)(
        'rejects %s expiry while permissions are being read',
        async (kind) => {
            const expiresAt =
                kind === 'idle'
                    ? state.nowMs + 1
                    : state.issuedAtMs + sessionConfig.absoluteDurationMs
            if (kind === 'idle') state.expiresAt = new Date(expiresAt)
            else state.expiresAt = new Date(expiresAt + 60_000)
            state.beforePermissions = async () => {
                state.nowMs = expiresAt
            }
            expect(await getCurrentUserAccess()).toEqual({
                userId: null,
                permissionKeys: [],
                isSuperUser: false,
            })
        },
    )
})

describe('read-only public session validation', () => {
    it('keeps email proof available to server policy and exposes bounded client deadlines', async () => {
        expect(await getActiveCurrentSessionUser()).toMatchObject({
            accountType: 'public',
            emailVerifiedAt: state.user.emailVerifiedAt,
        })
        const result = await validateSessionService()
        expect(result).toMatchObject({
            user: { id: state.user.id, username: state.user.username },
            expiresAt: state.expiresAt.toISOString(),
            absoluteExpiresAt: new Date(
                state.issuedAtMs + sessionConfig.absoluteDurationMs,
            ).toISOString(),
        })
        const serialized = JSON.stringify(result)
        expect(serialized).not.toContain(state.cookie!)
        expect(serialized).not.toContain(state.sessionHash)
        expect(serialized).not.toContain(state.user.passwordHash)
        expect(result.user).not.toHaveProperty('emailVerifiedAt')
    })

    it('caps the displayed idle deadline at the absolute deadline', async () => {
        const absolute = state.issuedAtMs + sessionConfig.absoluteDurationMs
        state.expiresAt = new Date(absolute + 60_000)
        expect(await validateSessionService()).toMatchObject({
            expiresAt: new Date(absolute).toISOString(),
            absoluteExpiresAt: new Date(absolute).toISOString(),
        })
    })

    it.each([
        'missing cookie',
        'legacy cookie',
        'missing row',
        'inactive',
        'deleted',
        'idle',
        'invalid date',
    ] as const)(
        'returns no user for %s without destructive cleanup',
        async (kind) => {
            if (kind === 'missing cookie') state.cookie = undefined
            if (kind === 'legacy cookie') state.cookie = 'legacy-opaque-cookie'
            if (kind === 'missing row') state.exists = false
            if (kind === 'inactive') state.user.isActive = false
            if (kind === 'deleted') state.user.isDeleted = true
            if (kind === 'idle') state.expiresAt = new Date(state.nowMs)
            if (kind === 'invalid date') state.expiresAt = new Date(Number.NaN)
            expect(await validateSessionService()).toEqual({
                user: null,
                maintenance: {
                    isActive: false,
                    isScheduled: false,
                    startsAt: null,
                },
            })
        },
    )

    it.each(['row', 'permissions', 'maintenance'] as const)(
        'rechecks expiry after the %s await',
        async (waitingFor) => {
            state.expiresAt = new Date(state.nowMs + 1)
            const expire = async () => {
                state.nowMs += 1
            }
            if (waitingFor === 'row') state.beforeRead = expire
            if (waitingFor === 'permissions') state.beforePermissions = expire
            if (waitingFor === 'maintenance') state.beforeMaintenance = expire
            expect((await validateSessionService()).user).toBeNull()
        },
    )

    it('does not delete a freshly extended row or clear a new cookie from a stale response', async () => {
        state.expiresAt = new Date(state.nowMs + 1)
        const replacementCookie =
            's1.' +
            state.nowMs +
            '.' +
            Buffer.alloc(32, 9).toString('base64url')
        state.beforeRead = async () => {
            state.nowMs += 1
            state.expiresAt = new Date(
                state.nowMs + sessionConfig.idleDurationMs,
            )
            state.cookie = replacementCookie
        }
        expect((await validateSessionService()).user).toBeNull()
        expect(state.cookie).toBe(replacementCookie)
        expect(state.expiresAt.getTime()).toBeGreaterThan(state.nowMs)
    })

    it('also rejects absolute expiry after the final maintenance await', async () => {
        const absolute = state.issuedAtMs + sessionConfig.absoluteDurationMs
        state.expiresAt = new Date(absolute + 60_000)
        state.beforeMaintenance = async () => {
            state.nowMs = absolute
        }
        expect((await validateSessionService()).user).toBeNull()
    })
})
