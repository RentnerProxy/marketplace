import { createLazyTestQuery } from '@/tests/shared/lazy-query.test.helpers.ts'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import { Buffer } from 'node:buffer'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { sessionConfig } from '@/config/session.config.ts'
import {
    clearRealtimeValidation,
    getRealtimeConnectionData,
    getRealtimeRevocationEpoch,
    startRealtimeValidation,
} from '@/websockets/Server/realtimeSessionValidation.ts'
import type {
    BunRealtimeWebSocket,
    BunUpgradeServer,
    RealtimeConnectionData,
} from '@/websockets/Types/bun.ts'
import {
    dispatchRealtimeEvent,
    registerRealtimeConnection,
    unregisterRealtimeConnection,
} from '@/websockets/Server/realtimeConnectionRegistry.ts'
import {
    handleRealtimeUpgrade,
    realtimeWebSocketHandler,
} from '@/websockets/Server/realtimeWebSocket.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import type {
    SessionValidationTestPredicate,
    SessionValidationTestRevocationEvent,
    SessionValidationTestTimer,
    SessionValidationTestUpgradeConnection,
} from './realtimeSessionValidation.test.types.ts'

const previousOrigin = process.env.ORIGIN
const NOW = Date.parse('2026-09-06T04:00:00.000Z')
const rawToken = 's1.' + NOW + '.' + Buffer.alloc(32, 7).toString('base64url')
const sessionHash = await createTokenHash(rawToken)
const schema = {
    sessions: {
        id: 'sessions.id',
        userId: 'sessions.userId',
        expiresAt: 'sessions.expiresAt',
    },
    users: {
        id: 'users.id',
        username: 'users.username',
        isActive: 'users.isActive',
        isDeleted: 'users.isDeleted',
    },
    permissions: { id: 'permissions.id', key: 'permissions.key' },
    userPermissions: {
        permissionId: 'userPermissions.permissionId',
        userId: 'userPermissions.userId',
    },
}
const row = {
    userId: 'user-1',
    username: 'synthetic-user',
    isActive: true,
    isDeleted: false,
    expiresAt: new Date(NOW + 60_000),
}
const beforePermissions = vi.fn(async function () {})
const state = {
    present: true,
    permissions: ['user.dashboard'],
    acceptedHash: sessionHash,
}
const select = vi.fn(function () {
    let table: unknown
    let predicate: SessionValidationTestPredicate | undefined
    const query = {
        from(value: unknown) {
            table = value
            return query
        },
        innerJoin() {
            return query
        },
        where(value: SessionValidationTestPredicate) {
            predicate = value
            return query
        },

        ...createLazyTestQuery(() =>
            (async function () {
                if (table !== schema.userPermissions)
                    throw new Error(
                        'Unexpected unbounded synthetic session query',
                    )
                await beforePermissions()
                return state.permissions.map((key) => ({ key }))
            })(),
        ),
        async limit() {
            if (table === schema.sessions) {
                return state.present && predicate?.value === state.acceptedHash
                    ? [{ ...row }]
                    : []
            }
            if (table === schema.userPermissions) {
                await beforePermissions()
                return state.permissions.map((key) => ({ key }))
            }
            throw new Error('Unexpected synthetic session query')
        },
    }
    return query
})
const mutation = vi.fn(function () {
    throw new Error('WebSocket attempted a session mutation')
})
const logError = vi.fn()
vi.mock('@/db', () => ({
    db: {
        select,
        update: mutation,
        insert: mutation,
        delete: mutation,
        transaction: mutation,
    },
}))
vi.mock('@/db/schema.ts', () => schema)
vi.mock('@/server/Admin/Backups/restore-state.service.ts', () => ({
    isRestoreStateActiveService: async () => false,
}))
vi.mock('drizzle-orm', () => ({
    eq: (column: unknown, value: unknown) => ({ column, value }),
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError }))

const timerDescriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    setInterval: Object.getOwnPropertyDescriptor(globalThis, 'setInterval'),
}
const realSetTimeout = globalThis.setTimeout.bind(globalThis)
const realClearTimeout = globalThis.clearTimeout.bind(globalThis)
const timeouts: Array<SessionValidationTestTimer> = []
const intervals: Array<SessionValidationTestTimer> = []
const sockets: Array<BunRealtimeWebSocket> = []

function installTimers() {
    for (const [name, scheduled] of [
        ['setTimeout', timeouts],
        ['setInterval', intervals],
    ] as const) {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value(callback: unknown, delay?: number) {
                const handle = realSetTimeout(function () {}, 600_000)
                handle.unref()
                scheduled.push({
                    handle,
                    delay,
                    run() {
                        if (typeof callback !== 'function')
                            throw new Error('Expected callback')
                        callback()
                    },
                })
                return handle
            },
        })
    }
}

async function flushReads() {
    await new Promise<void>((resolve) => realSetTimeout(resolve, 0))
}

function socket() {
    const websocket = {
        data: {
            userId: row.userId,
            username: row.username,
            permissions: [...state.permissions],
            sessionHash,
            revocationEpoch: getRealtimeRevocationEpoch(),
            expiresAt: row.expiresAt.toISOString(),
            absoluteExpiresAt: new Date(
                NOW + sessionConfig.absoluteDurationMs,
            ).toISOString(),
        },
        close: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        send: vi.fn(),
    } satisfies BunRealtimeWebSocket
    sockets.push(websocket)
    return websocket
}

function request(token = rawToken) {
    return new Request('https://example.test/ws', {
        headers: { cookie: 'session_id=' + encodeURIComponent(token) },
    })
}

beforeEach(function () {
    process.env.ORIGIN = 'https://example.test'
    setSystemTime(NOW)
    vi.clearAllMocks()
    beforePermissions.mockReset().mockResolvedValue(undefined)
    Object.assign(row, {
        isActive: true,
        isDeleted: false,
        expiresAt: new Date(NOW + 60_000),
    })
    state.present = true
    state.acceptedHash = sessionHash
    state.permissions = ['user.dashboard']
})
afterEach(function () {
    for (const websocket of sockets.splice(0)) {
        clearRealtimeValidation(websocket)
        unregisterRealtimeConnection(websocket)
    }
    for (const timer of [...timeouts.splice(0), ...intervals.splice(0)])
        realClearTimeout(timer.handle)
    for (const name of ['setTimeout', 'setInterval'] as const) {
        const descriptor = timerDescriptors[name]
        if (!descriptor) throw new Error('Missing original timer descriptor')
        Object.defineProperty(globalThis, name, descriptor)
    }
    vi.restoreAllMocks()
    setSystemTime()
    if (previousOrigin === undefined) delete process.env.ORIGIN
    else process.env.ORIGIN = previousOrigin
})

describe('read-only bounded WebSocket sessions', function () {
    it.each(['', 'legacy-session', 's1.bad.bad'])(
        'rejects malformed or legacy cookies before querying',
        async function (value) {
            expect(await getRealtimeConnectionData(request(value))).toBeNull()
            expect(select).not.toHaveBeenCalled()
        },
    )

    it('binds the absolute deadline to the whole authenticated cookie without exposing the raw token', async function () {
        const data = await getRealtimeConnectionData(request())
        expect(data).toEqual(socket().data)
        expect(JSON.stringify(data)).not.toContain(rawToken)
        expect(mutation).not.toHaveBeenCalled()
    })

    it('rejects an altered issue time because its database hash no longer matches', async function () {
        expect(
            await getRealtimeConnectionData(
                request(rawToken.replace(String(NOW), String(NOW - 1))),
            ),
        ).toBeNull()
        expect(beforePermissions).not.toHaveBeenCalled()
    })

    it.each(['inactive', 'deleted', 'revoked', 'idle expiry'])(
        'rejects a session at %s without extending it',
        async function (reason) {
            if (reason === 'inactive') row.isActive = false
            if (reason === 'deleted') row.isDeleted = true
            if (reason === 'revoked') state.present = false
            if (reason === 'idle expiry') row.expiresAt = new Date(NOW)
            expect(await getRealtimeConnectionData(request())).toBeNull()
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it('rechecks expiry after a slow permission read', async function () {
        beforePermissions.mockImplementationOnce(async function () {
            setSystemTime(NOW + 60_000)
        })
        expect(await getRealtimeConnectionData(request())).toBeNull()
        expect(mutation).not.toHaveBeenCalled()
    })

    it('closes a connection at the absolute deadline even when the database has a later idle value', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        row.expiresAt = new Date(
            NOW + sessionConfig.absoluteDurationMs + 60_000,
        )
        setSystemTime(NOW + sessionConfig.absoluteDurationMs)
        intervals[0].run()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(select).not.toHaveBeenCalled()
        expect(mutation).not.toHaveBeenCalled()
    })

    it('preserves another tab touch once revalidation confirms it before the old deadline', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        const oldTimer = timeouts[0]
        row.expiresAt = new Date(NOW + 15 * 60_000)
        setSystemTime(NOW + 59_000)
        intervals[0].run()
        await flushReads()
        expect(websocket.close).not.toHaveBeenCalled()
        expect(websocket.data.expiresAt).toBe(row.expiresAt.toISOString())
        setSystemTime(NOW + 60_000)
        oldTimer.run()
        expect(websocket.close).not.toHaveBeenCalled()
        expect(timeouts.at(-1)?.delay).toBe(14 * 60_000)
        expect(mutation).not.toHaveBeenCalled()
    })

    it('closes before subscribing when connection setup has crossed its confirmed deadline', function () {
        installTimers()
        const websocket = socket()
        setSystemTime(NOW + 60_000)
        row.expiresAt = new Date(NOW + 15 * 60_000)
        expect(startRealtimeValidation(websocket)).toBe(false)
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(timeouts).toHaveLength(0)
        expect(intervals).toHaveLength(0)
        expect(select).not.toHaveBeenCalled()
    })

    it.each(['idle', 'absolute'])(
        'closes at the %s deadline while a permission query is still unresolved',
        async function (kind) {
            installTimers()
            const deadline =
                NOW +
                (kind === 'absolute'
                    ? sessionConfig.absoluteDurationMs
                    : 60_000)
            const websocket = socket()
            websocket.data.expiresAt = new Date(deadline).toISOString()
            row.expiresAt = new Date(
                NOW + sessionConfig.absoluteDurationMs + 60_000,
            )
            setSystemTime(deadline - 1)
            startRealtimeValidation(websocket)
            const pending = Promise.withResolvers<void>()
            beforePermissions.mockImplementationOnce(async function () {
                await pending.promise
            })
            intervals[0].run()
            await flushReads()
            expect(beforePermissions).toHaveBeenCalledTimes(1)
            expect(websocket.close).not.toHaveBeenCalled()
            setSystemTime(deadline)
            timeouts[0].run()
            expect(websocket.close).toHaveBeenCalledTimes(1)
            expect(websocket.close).toHaveBeenCalledWith(
                4001,
                expect.any(String),
            )
            expect(websocket.unsubscribe).toHaveBeenCalledWith(
                'system-settings',
            )
            expect(websocket.unsubscribe).toHaveBeenCalledWith(
                'maintenance-mode',
            )
            expect(websocket.unsubscribe).toHaveBeenCalledWith('user:user-1')
            const scheduled = timeouts.length
            pending.resolve()
            await flushReads()
            expect(timeouts).toHaveLength(scheduled)
            expect(websocket.close).toHaveBeenCalledTimes(1)
            expect(websocket.data.expiresAt).toBe(
                new Date(deadline).toISOString(),
            )
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it('rejects a late successful database result even if the overdue timer has not fired yet', async function () {
        installTimers()
        const websocket = socket()
        row.expiresAt = new Date(NOW + 15 * 60_000)
        startRealtimeValidation(websocket)
        beforePermissions.mockImplementationOnce(async function () {
            setSystemTime(NOW + 60_000)
        })
        intervals[0].run()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(websocket.data.expiresAt).toBe(
            new Date(NOW + 60_000).toISOString(),
        )
        expect(timeouts).toHaveLength(1)
    })

    it('does not revive a revoked connection during periodic validation', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        state.present = false
        intervals[0].run()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(mutation).not.toHaveBeenCalled()
    })

    it('closes after a permission change without renewing session lifetime', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        state.permissions = []
        intervals[0].run()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(mutation).not.toHaveBeenCalled()
    })

    it('does not restart timers after the connection was cleared during a pending query', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        beforePermissions.mockImplementationOnce(async function () {
            clearRealtimeValidation(websocket)
        })
        const initialTimeouts = timeouts.length
        intervals[0].run()
        await flushReads()
        expect(timeouts).toHaveLength(initialTimeouts)
        expect(websocket.close).not.toHaveBeenCalled()
    })

    it('contains validation failures and closes without any database mutation', async function () {
        installTimers()
        const websocket = socket()
        startRealtimeValidation(websocket)
        beforePermissions.mockRejectedValueOnce(
            new Error('Synthetic database failure'),
        )
        intervals[0].run()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(1011, expect.any(String))
        expect(logError).toHaveBeenCalledTimes(1)
        expect(mutation).not.toHaveBeenCalled()
    })
})

function revocationEvent(userId = row.userId): UserSessionsRevokedEvent {
    return {
        type: 'user.sessions-revoked',
        payload: { userId, revokedAt: new Date().toISOString() },
    }
}

function publishRevocation(userId = row.userId, observe = function () {}) {
    const event = revocationEvent(userId)
    dispatchRealtimeEvent(
        {
            publish() {
                observe()
                return 0
            },
            async stop() {},
        },
        'user:' + userId,
        event,
    )
    return event
}

function trackedSocket() {
    const websocket = socket()
    const topics = new Set<string>()
    websocket.subscribe.mockImplementation((topic: string) => {
        topics.add(topic)
    })
    websocket.unsubscribe.mockImplementation((topic: string) => {
        topics.delete(topic)
    })
    registerRealtimeConnection(websocket)
    startRealtimeValidation(websocket)
    return { websocket, topics }
}

describe('generation-bound factor-change session revocation', function () {
    it('suspends all affected sockets before publish, closes the old hash, and preserves a newer login and another user', async function () {
        installTimers()
        const old = trackedSocket()
        const current = trackedSocket()
        current.websocket.data.sessionHash = 'b'.repeat(64)
        state.acceptedHash = current.websocket.data.sessionHash
        const foreign = socket()
        foreign.data.userId = 'other-user'
        registerRealtimeConnection(foreign)
        startRealtimeValidation(foreign)
        old.websocket.send.mockClear()
        current.websocket.send.mockClear()
        const event = publishRevocation(row.userId, function () {
            expect(old.topics.size).toBe(0)
            expect(current.topics.size).toBe(0)
            expect(foreign.unsubscribe).not.toHaveBeenCalled()
        })
        expect(old.websocket.close).not.toHaveBeenCalled()
        await flushReads()
        expect(old.websocket.close).toHaveBeenCalledWith(
            4001,
            expect.any(String),
        )
        expect(old.websocket.send).toHaveBeenCalledWith(JSON.stringify(event))
        expect(current.websocket.close).not.toHaveBeenCalled()
        expect(current.websocket.send).not.toHaveBeenCalled()
        expect(current.topics.has('user:user-1')).toBe(true)
        expect(foreign.close).not.toHaveBeenCalled()
        expect(select).toHaveBeenCalledTimes(3)
        expect(mutation).not.toHaveBeenCalled()
    })

    it('coalesces repeated events while an older periodic read remains unresolved and never resumes that snapshot', async function () {
        installTimers()
        const { websocket, topics } = trackedSocket()
        websocket.subscribe.mockClear()
        websocket.send.mockClear()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        intervals[0].run()
        await flushReads()
        expect(select).toHaveBeenCalledTimes(2)
        state.present = false
        for (let index = 0; index < 100; index += 1) publishRevocation()
        expect(select).toHaveBeenCalledTimes(2)
        expect(topics.size).toBe(0)
        expect(websocket.unsubscribe).toHaveBeenCalledTimes(3)
        realtimeWebSocketHandler.message(websocket, 'ping')
        expect(websocket.send).not.toHaveBeenCalled()
        pending.resolve()
        await flushReads()
        expect(select).toHaveBeenCalledTimes(3)
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(topics.size).toBe(0)
        expect(websocket.close).toHaveBeenCalledTimes(1)
        expect(mutation).not.toHaveBeenCalled()
    })

    it.each(['success', 'failure'])(
        'discards an obsolete %s and performs one current read before resubscribing',
        async function (outcome) {
            installTimers()
            const { websocket, topics } = trackedSocket()
            const pending = Promise.withResolvers<void>()
            beforePermissions.mockImplementationOnce(() => pending.promise)
            intervals[0].run()
            await flushReads()
            publishRevocation()
            websocket.subscribe.mockClear()
            websocket.send.mockClear()
            expect(topics.size).toBe(0)
            if (outcome === 'success') pending.resolve()
            else pending.reject(new Error('Obsolete synthetic read'))
            await flushReads()
            expect(select).toHaveBeenCalledTimes(4)
            expect(websocket.subscribe).toHaveBeenCalledTimes(3)
            expect(websocket.close).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            expect(logError).not.toHaveBeenCalled()
            expect(websocket.data.expiresAt).toBe(
                new Date(NOW + 60_000).toISOString(),
            )
            realtimeWebSocketHandler.message(websocket, 'ping')
            expect(websocket.send).toHaveBeenCalledWith('pong')
        },
    )

    it('keeps suspended connections registered so a second event invalidates the first fresh read', async function () {
        installTimers()
        const { websocket, topics } = trackedSocket()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        publishRevocation()
        await flushReads()
        state.present = false
        publishRevocation()
        expect(topics.size).toBe(0)
        websocket.subscribe.mockClear()
        pending.resolve()
        await flushReads()
        expect(select).toHaveBeenCalledTimes(3)
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(websocket.close).toHaveBeenCalledTimes(1)
    })

    it('keeps the original hard deadline while a suspended query is unresolved', async function () {
        installTimers()
        const { websocket, topics } = trackedSocket()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        publishRevocation()
        await flushReads()
        websocket.send.mockClear()
        websocket.subscribe.mockClear()
        setSystemTime(NOW + 60_000)
        timeouts[0].run()
        expect(topics.size).toBe(0)
        expect(websocket.close).toHaveBeenCalledTimes(1)
        expect(websocket.send).not.toHaveBeenCalled()
        const count = timeouts.length
        pending.resolve()
        await flushReads()
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(timeouts).toHaveLength(count)
    })
})

describe('revocation across upgrade and close boundaries', function () {
    it('does not admit an old handshake which was still reading permissions when revocation arrived', async function () {
        installTimers()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        const handshake = getRealtimeConnectionData(request())
        await flushReads()
        expect(beforePermissions).toHaveBeenCalledTimes(1)
        publishRevocation()
        state.present = false
        pending.resolve()
        const data = await handshake
        expect(data).not.toBeNull()
        if (!data) throw new Error('Expected the captured handshake fixture')
        const websocket = socket()
        websocket.data = data
        realtimeWebSocketHandler.open(websocket)
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(websocket.send).not.toHaveBeenCalled()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(4001, expect.any(String))
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(select).toHaveBeenCalledTimes(3)
    })

    it('freshly validates a prepared handshake after an event and announces readiness only once', async function () {
        installTimers()
        const data = await getRealtimeConnectionData(request())
        if (!data) throw new Error('Missing valid synthetic handshake')
        publishRevocation('different-user')
        const websocket = socket()
        websocket.data = data
        realtimeWebSocketHandler.open(websocket)
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(websocket.send).not.toHaveBeenCalled()
        await flushReads()
        expect(websocket.subscribe).toHaveBeenCalledTimes(3)
        expect(websocket.send).toHaveBeenCalledTimes(1)
        expect(JSON.parse(websocket.send.mock.calls[0][0])).toEqual({
            type: 'connection.ready',
            payload: { connectedAt: new Date(NOW).toISOString() },
        })
        expect(websocket.close).not.toHaveBeenCalled()
        publishRevocation()
        await flushReads()
        expect(websocket.send).toHaveBeenCalledTimes(1)
        expect(select).toHaveBeenCalledTimes(6)
    })

    it('does not miss a second revocation during deferred handshake validation', async function () {
        installTimers()
        const data = await getRealtimeConnectionData(request())
        if (!data) throw new Error('Missing valid synthetic handshake')
        publishRevocation()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        const websocket = socket()
        websocket.data = data
        realtimeWebSocketHandler.open(websocket)
        await flushReads()
        state.present = false
        publishRevocation()
        pending.resolve()
        await flushReads()
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(websocket.close).toHaveBeenCalledTimes(1)
        expect(websocket.send).toHaveBeenCalledWith(
            JSON.stringify(revocationEvent()),
        )
        expect(select).toHaveBeenCalledTimes(5)
    })

    it('cannot resubscribe after an exact-session close races with a suspended read', async function () {
        installTimers()
        const { websocket, topics } = trackedSocket()
        const pending = Promise.withResolvers<void>()
        beforePermissions.mockImplementationOnce(() => pending.promise)
        publishRevocation()
        await flushReads()
        websocket.subscribe.mockClear()
        dispatchRealtimeEvent(
            {
                publish() {
                    return 0
                },
                async stop() {},
            },
            'user:' + row.userId,
            {
                type: 'session.revoked',
                payload: {
                    userId: row.userId,
                    sessionHash,
                    revokedAt: new Date().toISOString(),
                },
            },
        )
        const scheduled = timeouts.length
        pending.resolve()
        await flushReads()
        expect(websocket.subscribe).not.toHaveBeenCalled()
        expect(topics.size).toBe(0)
        expect(timeouts).toHaveLength(scheduled)
        expect(websocket.close).toHaveBeenCalledTimes(1)
    })

    it('closes on a current database failure without claiming a confirmed revocation', async function () {
        installTimers()
        const { websocket, topics } = trackedSocket()
        websocket.send.mockClear()
        beforePermissions.mockRejectedValueOnce(
            new Error('Current synthetic database failure'),
        )
        publishRevocation()
        await flushReads()
        expect(websocket.close).toHaveBeenCalledWith(1011, expect.any(String))
        expect(websocket.send).not.toHaveBeenCalled()
        expect(logError).toHaveBeenCalledTimes(1)
        expect(topics.size).toBe(0)
        expect(mutation).not.toHaveBeenCalled()
    })
})

const revocationEventTypes: Array<
    SessionValidationTestRevocationEvent['type']
> = [
    'user.updated',
    'user.access-revoked',
    'session.revoked',
    'realtime.reauthentication-required',
    'user.sessions-revoked',
]

function securityRevocationEvent(
    type: SessionValidationTestRevocationEvent['type'],
): SessionValidationTestRevocationEvent {
    const timestamp = new Date(NOW).toISOString()
    switch (type) {
        case 'user.updated':
            return {
                type,
                payload: {
                    userId: row.userId,
                    username: row.username,
                    previousUsername: row.username,
                    permissionKeys: [],
                    previousPermissionKeys: ['user.dashboard'],
                    addedPermissionKeys: [],
                    removedPermissionKeys: ['user.dashboard'],
                    updatedAt: timestamp,
                },
            }
        case 'user.access-revoked':
            return {
                type,
                payload: {
                    userId: row.userId,
                    reason: 'deactivated',
                    updatedAt: timestamp,
                },
            }
        case 'session.revoked':
            return {
                type,
                payload: {
                    userId: row.userId,
                    sessionHash,
                    revokedAt: timestamp,
                },
            }
        case 'realtime.reauthentication-required':
            return {
                type,
                payload: { reason: 'restore', requestedAt: timestamp },
            }
        case 'user.sessions-revoked':
            return {
                type,
                payload: { userId: row.userId, revokedAt: timestamp },
            }
    }
    throw new Error('Unbekannter Widerrufsgrund im Test.')
}

function dispatchSecurityRevocation(
    type: SessionValidationTestRevocationEvent['type'],
    publish = function () {},
) {
    dispatchRealtimeEvent(
        {
            publish() {
                publish()
                return 0
            },
            async stop() {},
        },
        'user:' + row.userId,
        securityRevocationEvent(type),
    )
}

function beginUpgrade() {
    const connection: SessionValidationTestUpgradeConnection = { data: null }
    const upgradeServer = {
        requestIP() {
            return null
        },
        upgrade(_request, options) {
            connection.data = options?.data ?? null
            return true
        },
    } satisfies BunUpgradeServer
    const result = handleRealtimeUpgrade(
        new Request('https://example.test/ws', {
            headers: {
                cookie: 'session_id=' + encodeURIComponent(rawToken),
                origin: 'https://example.test',
                upgrade: 'websocket',
            },
        }),
        upgradeServer,
    )
    return { connection, result }
}

function openUpgradedConnection(data: RealtimeConnectionData | null) {
    if (!data) throw new Error('Expected the prepared upgrade data')
    const websocket = socket()
    websocket.data = data
    realtimeWebSocketHandler.open(websocket)
    return websocket
}

describe('all revocation types invalidate unregistered upgrade snapshots', function () {
    it.each(revocationEventTypes)(
        '%s invalidates exactly once before synchronous publication',
        async function (type) {
            const validation =
                await import('@/websockets/Server/realtimeSessionValidation.ts')
            const invalidate = vi.spyOn(
                validation,
                'invalidateRealtimeRevocationEpoch',
            )
            const previousEpoch = getRealtimeRevocationEpoch()
            let publicationEpoch = previousEpoch
            dispatchSecurityRevocation(type, function () {
                publicationEpoch = getRealtimeRevocationEpoch()
                expect(publicationEpoch).not.toBe(previousEpoch)
                expect(invalidate).toHaveBeenCalledTimes(1)
            })
            expect(getRealtimeRevocationEpoch()).toBe(publicationEpoch)
            expect(invalidate).toHaveBeenCalledTimes(1)
            expect(select).not.toHaveBeenCalled()
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it.each(revocationEventTypes)(
        '%s rejects a prepared session even when another session of the same user exists',
        async function (type) {
            installTimers()
            const upgrade = beginUpgrade()
            expect(await upgrade.result).toBeUndefined()
            expect(upgrade.connection.data?.sessionHash).toBe(sessionHash)
            state.acceptedHash = 'b'.repeat(64)
            dispatchSecurityRevocation(type)
            const websocket = openUpgradedConnection(upgrade.connection.data)
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            await flushReads()
            expect(websocket.close).toHaveBeenCalledWith(
                4001,
                expect.any(String),
            )
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            expect(select).toHaveBeenCalledTimes(3)
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it.each(revocationEventTypes)(
        '%s invalidates an upgrade still awaiting its initial permission snapshot',
        async function (type) {
            installTimers()
            const pending = Promise.withResolvers<void>()
            beforePermissions.mockImplementationOnce(() => pending.promise)
            const upgrade = beginUpgrade()
            await flushReads()
            expect(beforePermissions).toHaveBeenCalledTimes(1)
            expect(upgrade.connection.data).toBeNull()
            state.present = false
            dispatchSecurityRevocation(type)
            pending.resolve()
            expect(await upgrade.result).toBeUndefined()
            const websocket = openUpgradedConnection(upgrade.connection.data)
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            await flushReads()
            expect(websocket.close).toHaveBeenCalledWith(
                4001,
                expect.any(String),
            )
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            expect(select).toHaveBeenCalledTimes(3)
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it.each(revocationEventTypes)(
        '%s rejects changed permissions before publishing readiness',
        async function (type) {
            installTimers()
            const upgrade = beginUpgrade()
            expect(await upgrade.result).toBeUndefined()
            state.permissions = []
            dispatchSecurityRevocation(type)
            const websocket = openUpgradedConnection(upgrade.connection.data)
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            await flushReads()
            expect(websocket.close).toHaveBeenCalledWith(
                4001,
                expect.any(String),
            )
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            expect(select).toHaveBeenCalledTimes(4)
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it.each(revocationEventTypes)(
        '%s waits for a fresh valid check before subscribing and announcing readiness',
        async function (type) {
            installTimers()
            const upgrade = beginUpgrade()
            expect(await upgrade.result).toBeUndefined()
            dispatchSecurityRevocation(type)
            const pending = Promise.withResolvers<void>()
            beforePermissions.mockImplementationOnce(() => pending.promise)
            const websocket = openUpgradedConnection(upgrade.connection.data)
            await flushReads()
            expect(beforePermissions).toHaveBeenCalledTimes(2)
            expect(websocket.subscribe).not.toHaveBeenCalled()
            expect(websocket.send).not.toHaveBeenCalled()
            realtimeWebSocketHandler.message(websocket, 'ping')
            expect(websocket.send).not.toHaveBeenCalled()
            pending.resolve()
            await flushReads()
            expect(websocket.subscribe.mock.calls).toEqual([
                ['system-settings'],
                ['maintenance-mode'],
                ['user:' + row.userId],
            ])
            expect(websocket.send).toHaveBeenCalledTimes(1)
            expect(websocket.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: 'connection.ready',
                    payload: { connectedAt: new Date(NOW).toISOString() },
                }),
            )
            expect(websocket.close).not.toHaveBeenCalled()
            expect(websocket.data.sessionHash).toBe(sessionHash)
            intervals[0].run()
            await flushReads()
            expect(websocket.send).toHaveBeenCalledTimes(1)
            expect(websocket.subscribe).toHaveBeenCalledTimes(3)
            expect(select).toHaveBeenCalledTimes(6)
            expect(mutation).not.toHaveBeenCalled()
        },
    )

    it('keeps prepared session snapshots for unrelated events', async function () {
        installTimers()
        const upgrade = beginUpgrade()
        expect(await upgrade.result).toBeUndefined()
        const previousEpoch = getRealtimeRevocationEpoch()
        dispatchRealtimeEvent(
            { publish: () => 0, async stop() {} },
            'system-settings',
            {
                type: 'system-settings.updated',
                payload: {
                    companyName: 'Synthetic company',
                    updatedAt: new Date(NOW).toISOString(),
                },
            },
        )
        expect(getRealtimeRevocationEpoch()).toBe(previousEpoch)
        const websocket = openUpgradedConnection(upgrade.connection.data)
        expect(websocket.subscribe).toHaveBeenCalledTimes(3)
        expect(websocket.send).toHaveBeenCalledTimes(1)
        expect(select).toHaveBeenCalledTimes(2)
        expect(mutation).not.toHaveBeenCalled()
    })
})
