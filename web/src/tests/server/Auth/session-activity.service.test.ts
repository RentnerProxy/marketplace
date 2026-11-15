import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    database,
    resetActivityLock,
    schema,
    services,
    STARTED_AT,
    state,
} from './session-activity.service.test.helpers.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { sessionConfig, SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'

const { touchCurrentSessionActivityService } =
    await import('@/server/Auth/session-activity.service.ts')

const entropy = Buffer.alloc(32, 5).toString('base64url')
let issuedAtMs = STARTED_AT - 10 * 60_000
let ownHash = ''
function deadline() {
    const expiresAt = state.rows.sessions[0]?.expiresAt
    if (!(expiresAt instanceof Date)) throw new Error('Missing test deadline')
    return expiresAt.getTime()
}
function advanceTo(nowMs: number) {
    state.nowMs = nowMs
    state.databaseNowMs = nowMs
}
async function expireAtCurrentDeadline() {
    advanceTo(deadline())
}
async function expireAtIdleDeadline() {
    advanceTo(STARTED_AT + sessionConfig.idleDurationMs)
}
async function setTokenIssuedAt(value: number) {
    issuedAtMs = value
    state.cookie = 's1.' + value + '.' + entropy
    ownHash = await createTokenHash(state.cookie)
    state.rows.sessions[0].id = ownHash
}

beforeEach(async () => {
    vi.clearAllMocks()
    resetActivityLock()
    advanceTo(STARTED_AT)
    state.rows = {
        users: [{ id: 'user-1', isActive: true, isDeleted: false }],
        sessions: [
            {
                id: '',
                userId: 'user-1',
                expiresAt: new Date(
                    STARTED_AT +
                        sessionConfig.idleDurationMs -
                        sessionConfig.activityThrottleMs,
                ),
            },
            {
                id: 'other-session-for-same-user',
                userId: 'user-1',
                expiresAt: new Date(STARTED_AT + 5 * 60_000),
            },
            {
                id: 'foreign-session',
                userId: 'other-user',
                expiresAt: new Date(STARTED_AT + 5 * 60_000),
            },
        ],
    }
    await setTokenIssuedAt(STARTED_AT - 10 * 60_000)
    state.events = []
    state.userConditions = []
    state.sessionConditions = []
    state.updateConditions = []
    state.writes = 0
    state.rateFailure = null
    state.beforeUserLock = null
    state.afterUserLock = null
    state.afterSessionLock = null
    state.beforeUpdate = null
    state.afterUpdate = null
    state.beforeCommit = null
    state.beforeSessionRateLimit = null
    vi.spyOn(Date, 'now').mockImplementation(() => state.nowMs)
})
afterEach(() => {
    expect(services.setCookie).not.toHaveBeenCalled()
    expect(services.deleteCookie).not.toHaveBeenCalled()
    vi.restoreAllMocks()
})

describe('authenticated session activity', () => {
    it('extends only its own hash after User then Session locks and applies both independent quotas', async () => {
        const otherSessions = structuredClone(state.rows.sessions.slice(1))
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: true,
            expiresAt: new Date(
                STARTED_AT + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        expect(state.writes).toBe(1)
        expect(state.rows.sessions.slice(1)).toEqual(otherSessions)
        expect(services.getCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME)
        expect(services.enforceRateLimit.mock.calls).toEqual([
            [
                {
                    ...RATE_LIMITS.sessionActivityIp,
                    scope: 'session-activity-ip',
                },
            ],
            [
                {
                    ...RATE_LIMITS.sessionActivitySession,
                    scope: 'session-activity-session',
                    identifiers: [ownHash],
                    includeClientIp: false,
                },
            ],
        ])
        expect(state.events).toEqual([
            'session-activity-ip',
            'identity-read',
            'session-activity-session',
            'begin',
            'user-lock',
            'session-lock',
            'update',
            'commit',
        ])
        expect(state.userConditions).toEqual([
            {
                kind: 'and',
                conditions: [
                    { kind: 'eq', column: schema.users.id, value: 'user-1' },
                    { kind: 'eq', column: schema.users.isActive, value: true },
                    {
                        kind: 'eq',
                        column: schema.users.isDeleted,
                        value: false,
                    },
                ],
            },
        ])
        expect(state.sessionConditions).toEqual([
            {
                kind: 'and',
                conditions: [
                    { kind: 'eq', column: schema.sessions.id, value: ownHash },
                    {
                        kind: 'eq',
                        column: schema.sessions.userId,
                        value: 'user-1',
                    },
                ],
            },
        ])
        expect(state.updateConditions).toHaveLength(1)
        const updateCondition = state.updateConditions[0]
        if (updateCondition.kind !== 'and')
            throw new Error('Missing bounded update')
        expect(updateCondition.conditions).toContainEqual({
            kind: 'eq',
            column: schema.sessions.id,
            value: ownHash,
        })
        expect(updateCondition.conditions).toContainEqual({
            kind: 'eq',
            column: schema.sessions.userId,
            value: 'user-1',
        })
        expect(updateCondition.conditions).toContainEqual({
            kind: 'eq',
            column: schema.sessions.expiresAt,
            value: new Date(
                STARTED_AT +
                    sessionConfig.idleDurationMs -
                    sessionConfig.activityThrottleMs,
            ),
        })
        expect(
            JSON.stringify(await touchCurrentSessionActivityService()),
        ).not.toContain(ownHash)
        expect(state.writes).toBe(1)
    })

    it.each([
        { label: 'missing', cookie: undefined },
        { label: 'legacy', cookie: '00000000-0000-4000-8000-000000000001' },
        { label: 'malformed', cookie: 's1.12.bad' },
        { label: 'future', cookie: 's1.' + (STARTED_AT + 1) + '.' + entropy },
        {
            label: 'absolute expired',
            cookie:
                's1.' +
                (STARTED_AT - sessionConfig.absoluteDurationMs) +
                '.' +
                entropy,
        },
    ])(
        'rejects a $label cookie before any database lookup',
        async ({ cookie }) => {
            state.cookie = cookie
            expect(await touchCurrentSessionActivityService()).toEqual({
                active: false,
            })
            expect(services.enforceRateLimit).toHaveBeenCalledTimes(1)
            expect(database.select).not.toHaveBeenCalled()
            expect(database.transaction).not.toHaveBeenCalled()
            expect(state.writes).toBe(0)
        },
    )

    it.each(['different entropy', 'changed issue time'] as const)(
        'creates no session quota key for a well-formed but unmatched cookie with %s',
        async (change) => {
            state.cookie =
                change === 'different entropy'
                    ? 's1.' +
                      issuedAtMs +
                      '.' +
                      Buffer.alloc(32, 6).toString('base64url')
                    : 's1.' + STARTED_AT + '.' + entropy

            expect(await touchCurrentSessionActivityService()).toEqual({
                active: false,
            })
            expect(database.select).toHaveBeenCalledTimes(1)
            expect(database.transaction).not.toHaveBeenCalled()
            expect(services.enforceRateLimit.mock.calls).toEqual([
                [
                    {
                        ...RATE_LIMITS.sessionActivityIp,
                        scope: 'session-activity-ip',
                    },
                ],
            ])
            expect(state.events).toEqual([
                'session-activity-ip',
                'identity-read',
            ])
            expect(state.writes).toBe(0)
        },
    )

    it.each(['session-activity-ip', 'session-activity-session'])(
        'stops before the transaction when the %s quota fails',
        async (scope) => {
            state.rateFailure = scope
            await expect(touchCurrentSessionActivityService()).rejects.toThrow(
                'Synthetic rate limit',
            )
            expect(database.select).toHaveBeenCalledTimes(
                scope === 'session-activity-ip' ? 0 : 1,
            )
            expect(database.transaction).not.toHaveBeenCalled()
            if (scope === 'session-activity-ip')
                expect(services.getCookie).not.toHaveBeenCalled()
        },
    )

    it('does not use an absolute deadline that expired during rate limiting', async () => {
        state.beforeSessionRateLimit = async () => {
            advanceTo(issuedAtMs + sessionConfig.absoluteDurationMs)
        }
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(database.select).toHaveBeenCalledTimes(1)
        expect(database.transaction).not.toHaveBeenCalled()
        expect(state.writes).toBe(0)
    })

    it.each([
        'missing session',
        'missing user',
        'inactive user',
        'deleted user',
        'idle boundary',
        'invalid idle date',
    ] as const)('does not extend a %s', async (kind) => {
        if (kind === 'missing session') state.rows.sessions.shift()
        if (kind === 'missing user') state.rows.users = []
        if (kind === 'inactive user') state.rows.users[0].isActive = false
        if (kind === 'deleted user') state.rows.users[0].isDeleted = true
        if (kind === 'idle boundary')
            state.rows.sessions[0].expiresAt = new Date(STARTED_AT)
        if (kind === 'invalid idle date')
            state.rows.sessions[0].expiresAt = new Date(Number.NaN)
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(state.writes).toBe(0)
        expect(state.updateConditions).toEqual([])
    })

    it.each(['revoked', 'different owner'] as const)(
        'does not resurrect a %s session discovered before the user-lock wait',
        async (kind) => {
            state.beforeUserLock = async () => {
                if (kind === 'revoked') state.rows.sessions.shift()
                else state.rows.sessions[0].userId = 'other-user'
            }
            expect(await touchCurrentSessionActivityService()).toEqual({
                active: false,
            })
            expect(state.writes).toBe(0)
            expect(state.updateConditions).toEqual([])
        },
    )

    it.each(['user', 'session'] as const)(
        'rechecks idle expiry after waiting for the %s lock',
        async (lock) => {
            if (lock === 'user') state.afterUserLock = expireAtCurrentDeadline
            else state.afterSessionLock = expireAtCurrentDeadline
            expect(await touchCurrentSessionActivityService()).toEqual({
                active: false,
            })
            expect(state.writes).toBe(0)
            expect(state.updateConditions).toEqual([])
        },
    )

    it('rechecks absolute expiry after the final session lock', async () => {
        state.rows.sessions[0].expiresAt = new Date(
            issuedAtMs + sessionConfig.absoluteDurationMs + 60_000,
        )
        state.afterSessionLock = async () =>
            advanceTo(issuedAtMs + sessionConfig.absoluteDurationMs)
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(state.writes).toBe(0)
    })

    it('does not write before 60 seconds, then writes at the exact throttle boundary', async () => {
        state.rows.sessions[0].expiresAt = new Date(
            STARTED_AT + sessionConfig.idleDurationMs,
        )
        advanceTo(STARTED_AT + sessionConfig.activityThrottleMs - 1)
        expect((await touchCurrentSessionActivityService()).active).toBe(true)
        expect(state.writes).toBe(0)
        advanceTo(STARTED_AT + sessionConfig.activityThrottleMs)
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: true,
            expiresAt: new Date(
                state.nowMs + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        expect(state.writes).toBe(1)
    })

    it('caps renewal at the absolute deadline and avoids repeated writes of the cap', async () => {
        await setTokenIssuedAt(
            STARTED_AT - sessionConfig.absoluteDurationMs + 2 * 60_000,
        )
        state.rows.sessions[0].expiresAt = new Date(STARTED_AT + 60_000)
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: true,
            expiresAt: new Date(STARTED_AT + 2 * 60_000).toISOString(),
        })
        expect(state.writes).toBe(1)
        advanceTo(STARTED_AT + 60_000)
        expect((await touchCurrentSessionActivityService()).active).toBe(true)
        expect(state.writes).toBe(1)
        advanceTo(STARTED_AT + 2 * 60_000)
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(state.writes).toBe(1)
    })

    it('uses the database clock to reject an idle-expired UPDATE even when the application clock is earlier', async () => {
        const previousDeadline = deadline()
        state.beforeUpdate = async () => {
            state.databaseNowMs = previousDeadline
        }
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(state.updateConditions).toHaveLength(1)
        expect(state.writes).toBe(0)
        expect(deadline()).toBe(previousDeadline)
    })

    it('retains the absolute database-clock guard when an UPDATE waits past expiry', async () => {
        await setTokenIssuedAt(
            STARTED_AT - sessionConfig.absoluteDurationMs + 30_000,
        )
        state.rows.sessions[0].expiresAt = new Date(STARTED_AT + 20_000)
        state.beforeUpdate = async () => {
            state.databaseNowMs = STARTED_AT + 30_000
        }
        expect(await touchCurrentSessionActivityService()).toEqual({
            active: false,
        })
        expect(state.writes).toBe(0)
        expect(deadline()).toBe(STARTED_AT + 20_000)
        const guard = state.updateConditions[0]
        if (guard.kind !== 'and') throw new Error('Missing bounded update')
        expect(guard.conditions).toContainEqual({
            kind: 'absolute-live',
            value: new Date(STARTED_AT + 30_000).toISOString(),
        })
    })

    it.each(['update', 'commit'] as const)(
        'does not return active when the renewed deadline expires during %s completion',
        async (wait) => {
            if (wait === 'update') state.afterUpdate = expireAtIdleDeadline
            else state.beforeCommit = expireAtIdleDeadline
            expect(await touchCurrentSessionActivityService()).toEqual({
                active: false,
            })
            expect(deadline()).toBe(state.nowMs)
        },
    )

    it('serializes simultaneous touches and extends at most once', async () => {
        const results = await Promise.all([
            touchCurrentSessionActivityService(),
            touchCurrentSessionActivityService(),
        ])
        expect(results).toEqual([
            {
                active: true,
                expiresAt: new Date(
                    STARTED_AT + sessionConfig.idleDurationMs,
                ).toISOString(),
            },
            {
                active: true,
                expiresAt: new Date(
                    STARTED_AT + sessionConfig.idleDurationMs,
                ).toISOString(),
            },
        ])
        expect(state.writes).toBe(1)
        expect(state.updateConditions).toHaveLength(1)
        expect(
            state.events.filter((event) => event === 'user-lock'),
        ).toHaveLength(2)
    })

    it('propagates infrastructure failure and rolls the transaction back', async () => {
        const before = structuredClone(state.rows)
        state.beforeUpdate = async () => {
            throw new Error('Synthetic update unavailable')
        }
        await expect(touchCurrentSessionActivityService()).rejects.toThrow(
            'Synthetic update unavailable',
        )
        expect(state.rows).toEqual(before)
        expect(state.events.at(-1)).toBe('rollback')
    })
})
