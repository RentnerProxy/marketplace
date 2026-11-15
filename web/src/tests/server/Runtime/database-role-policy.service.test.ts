import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import { DATABASE_ROLE_POLICY } from '@/config/database-role-policy.config.ts'

const databaseUrl =
    'postgresql://runtime:synthetic-private-password@db.invalid:5432/app_test'
const driverFailure = new Error(
    'synthetic-private-password SELECT private-role',
)
const validRows = [
    {
        currentRoleId: '16384',
        sessionRoleId: '16384',
        databaseOwnerId: '16384',
        roleId: '16384',
        roleName: 'runtime',
        canLogin: true,
        isSuperuser: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canReplicate: false,
        canBypassRls: false,
        ownsOtherDatabase: false,
    },
]
const construct = vi.fn((_url: string, _options: unknown) => {})
const cancel = vi.fn(() => {})
const unsafe = vi.fn((_statement: string) =>
    Object.assign(Promise.resolve<unknown>(validRows), { cancel }),
)
const close = vi.fn(async (_options: { timeout: number }) => {})

class MockSql {
    constructor(url: string, options: unknown) {
        construct(url, options)
    }
    unsafe(statement: string) {
        return unsafe(statement)
    }
    close(options: { timeout: number }) {
        return close(options)
    }
}

// Coverage resolves the built-in SQL import through the global Bun namespace.
const sqlExports = Bun as unknown as {
    SQL: (url: string, options: unknown) => MockSql
}
const sqlConstructor = vi.spyOn(sqlExports, 'SQL')
sqlConstructor.mockImplementation((url, options) => new MockSql(url, options))
expect(sqlExports.SQL).toBe(sqlConstructor)
const { assertRuntimeDatabaseRolePolicyService: assertPolicy } =
    await import('@/server/Runtime/database-role-policy.service.ts')

async function flushPromises() {
    let pending = Promise.resolve()
    for (let index = 0; index < 12; index++) {
        pending = pending.then(() => undefined)
    }
    await pending
}

function captureFailure(operation: Promise<void>) {
    return operation.then(
        () => null,
        (error: unknown) => error,
    )
}

function expectSafeFailure(error: unknown) {
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('Expected policy failure')
    expect(error.message).toBe(DATABASE_ROLE_POLICY.errorMessage)
    expect(error.name).toBe('DatabaseRolePolicyError')
    expect(error).toHaveProperty('code', DATABASE_ROLE_POLICY.errorCode)
    expect(error).not.toHaveProperty('cause')
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error))
    expect(serialized).not.toContain('synthetic-private-password')
    expect(serialized).not.toContain('private-role')
    expect(serialized).not.toContain(databaseUrl)
}

beforeEach(function () {
    vi.useFakeTimers()
    construct.mockReset()
    cancel.mockReset()
    unsafe.mockReset()
    unsafe.mockImplementation(() =>
        Object.assign(Promise.resolve<unknown>(validRows), { cancel }),
    )
    close.mockReset()
    close.mockImplementation(async () => {})
})

afterEach(function () {
    vi.useRealTimers()
})

afterAll(function () {
    sqlConstructor.mockRestore()
})

describe('Runtime database role policy', function () {
    it('accepts the shared administrator connection without changing existing database ownership', async function () {
        const administratorUrl =
            'postgresql://postgres:synthetic-admin-password@db.invalid:5432/app_test'
        unsafe.mockReturnValueOnce(
            Object.assign(
                Promise.resolve([
                    {
                        ...validRows[0],
                        currentRoleId: '10',
                        sessionRoleId: '10',
                        roleId: '10',
                        roleName: 'postgres',
                        isSuperuser: true,
                        canCreateDatabase: true,
                        canCreateRole: true,
                        canReplicate: true,
                        canBypassRls: true,
                        ownsOtherDatabase: true,
                    },
                ]),
                { cancel },
            ),
        )
        expect(await captureFailure(assertPolicy(administratorUrl))).toBeNull()
        expect(construct.mock.calls[0]?.[0]).toBe(administratorUrl)
        expect(unsafe).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledWith({ timeout: 0 })
        expect(cancel).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('uses an independent single-connection PostgreSQL pool and always closes it', async function () {
        const outcome = await captureFailure(assertPolicy(databaseUrl))
        expect(construct).toHaveBeenCalledTimes(1)
        expect(unsafe).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledTimes(1)
        expect(outcome).toBeNull()
        expect(construct).toHaveBeenCalledWith(databaseUrl, {
            adapter: 'postgres',
            max: 1,
            connectionTimeout: DATABASE_ROLE_POLICY.connectionTimeoutSeconds,
            idleTimeout: DATABASE_ROLE_POLICY.idleTimeoutSeconds,
        })
        expect(unsafe).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledWith({ timeout: 0 })
        expect(cancel).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('uses one fixed catalog SELECT covering both identities and all membership edges', async function () {
        await assertPolicy(databaseUrl)
        const statement = unsafe.mock.calls[0]?.[0]
        expect(typeof statement).toBe('string')
        if (typeof statement !== 'string') throw new Error('Missing query')
        expect(statement).toContain('WITH RECURSIVE reachable_roles')
        expect(statement).toContain('CURRENT_USER')
        expect(statement).toContain('SESSION_USER')
        expect(statement).toContain(
            'membership.member OPERATOR(pg_catalog.=) reachable.role_oid',
        )
        expect(statement).toContain('SELECT membership.roleid')
        expect(statement).toContain('UNION')
        expect(statement).not.toContain('UNION ALL')
        for (const privilege of [
            'rolsuper',
            'rolcreatedb',
            'rolcreaterole',
            'rolreplication',
            'rolbypassrls',
        ]) {
            expect(statement).toContain(privilege)
        }
        expect(statement).toContain(
            'other_database.datdba OPERATOR(pg_catalog.=) role.oid',
        )
        expect(statement).toContain(
            'other_database.oid OPERATOR(pg_catalog.<>) context.database_oid',
        )
        expect(statement).toContain(
            `LIMIT ${DATABASE_ROLE_POLICY.maximumRoles + 1}`,
        )
        expect(statement).not.toMatch(
            /inherit_option|set_option|admin_option|rolinherit/u,
        )
        expect(statement).not.toMatch(
            /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|SET|CALL|COPY|BEGIN)\b/iu,
        )
        expect(statement).not.toContain(';')
        expect(statement).not.toContain('synthetic-private-password')
        expect(statement).not.toContain('runtime')
        const relations = [
            ...statement.matchAll(/(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)/giu),
        ]
        expect(relations.length).toBeGreaterThan(0)
        expect(
            relations.every((match) => match[1]?.startsWith('pg_catalog.')),
        ).toBe(true)
        expect(statement).toContain('pg_catalog.current_database()')
        expect(statement).toContain('::pg_catalog.text')
        expect(statement).not.toMatch(/\s(?:=|<>)\s/u)
        await assertPolicy(
            'postgres://another:another-secret@elsewhere.invalid/other?options=-c%20search_path%3Dpublic%2Cpg_catalog',
        )
        expect(unsafe.mock.calls[1]?.[0]).toBe(statement)
    })

    it.each([
        '',
        'not a url',
        'mysql://user:password@db/app',
        'sqlite://app.db',
    ])(
        'rejects invalid PostgreSQL URL %s before constructing a driver',
        async function (url) {
            expectSafeFailure(await captureFailure(assertPolicy(url)))
            expect(construct).not.toHaveBeenCalled()
            expect(unsafe).not.toHaveBeenCalled()
            expect(close).not.toHaveBeenCalled()
            expect(vi.getTimerCount()).toBe(0)
        },
    )

    it('sanitizes constructor errors before any SQL exists', async function () {
        construct.mockImplementationOnce(() => {
            throw driverFailure
        })
        expectSafeFailure(await captureFailure(assertPolicy(databaseUrl)))
        expect(unsafe).not.toHaveBeenCalled()
        expect(close).not.toHaveBeenCalled()
    })

    it.each([
        'query-throw',
        'query-reject',
        'malformed',
        'unsafe-role',
        'close-throw',
        'close-reject',
    ])(
        'fails closed and sanitizes %s while closing its own pool',
        async function (failure) {
            if (failure === 'query-throw')
                unsafe.mockImplementationOnce(() => {
                    throw driverFailure
                })
            if (failure === 'query-reject')
                unsafe.mockImplementationOnce(() =>
                    Object.assign(Promise.reject(driverFailure), { cancel }),
                )
            if (failure === 'malformed')
                unsafe.mockReturnValueOnce(
                    Object.assign(Promise.resolve({ rows: validRows }), {
                        cancel,
                    }),
                )
            if (failure === 'unsafe-role')
                unsafe.mockReturnValueOnce(
                    Object.assign(
                        Promise.resolve([
                            { ...validRows[0], canCreateRole: true },
                        ]),
                        { cancel },
                    ),
                )
            if (failure === 'close-throw')
                close.mockImplementationOnce(() => {
                    throw driverFailure
                })
            if (failure === 'close-reject')
                close.mockRejectedValueOnce(driverFailure)
            expectSafeFailure(await captureFailure(assertPolicy(databaseUrl)))
            expect(close).toHaveBeenCalledWith({ timeout: 0 })
            expect(cancel).not.toHaveBeenCalled()
            expect(vi.getTimerCount()).toBe(0)
        },
    )

    it('waits for successful cleanup before allowing startup', async function () {
        const closing = Promise.withResolvers<void>()
        close.mockReturnValueOnce(closing.promise)
        let accepted = false
        const assertion = assertPolicy(databaseUrl).then(() => {
            accepted = true
            return undefined
        })
        await flushPromises()
        expect(close).toHaveBeenCalledTimes(1)
        expect(accepted).toBe(false)
        closing.resolve()
        await assertion
        expect(accepted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('cancels the timed-out query and drains its rejection before failing', async function () {
        const query = Promise.withResolvers<unknown>()
        unsafe.mockReturnValueOnce(Object.assign(query.promise, { cancel }))
        cancel.mockImplementationOnce(() => {
            query.reject(driverFailure)
        })
        const result = captureFailure(assertPolicy(databaseUrl))
        await flushPromises()
        vi.advanceTimersByTime(DATABASE_ROLE_POLICY.queryTimeoutMs - 1)
        expect(cancel).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expectSafeFailure(await result)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledWith({ timeout: 0 })
        expect(vi.getTimerCount()).toBe(0)
    })

    it('forces close after a cancellation error and remains closed on late query success', async function () {
        const query = Promise.withResolvers<unknown>()
        unsafe.mockReturnValueOnce(Object.assign(query.promise, { cancel }))
        cancel.mockImplementationOnce(() => {
            throw driverFailure
        })
        close.mockImplementationOnce(async () => {
            query.resolve(validRows)
        })
        const result = captureFailure(assertPolicy(databaseUrl))
        await flushPromises()
        vi.advanceTimersByTime(DATABASE_ROLE_POLICY.queryTimeoutMs)
        expectSafeFailure(await result)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['query-does-not-drain', 'close-never-settles', 'neither-settles'])(
        'bounds cleanup when %s, without accepting or leaking late rejection',
        async function (failure) {
            const query = Promise.withResolvers<unknown>()
            const closing = Promise.withResolvers<void>()
            if (failure !== 'close-never-settles')
                unsafe.mockReturnValueOnce(
                    Object.assign(query.promise, { cancel }),
                )
            if (failure !== 'query-does-not-drain')
                close.mockReturnValueOnce(closing.promise)
            let settled = false
            const result = captureFailure(assertPolicy(databaseUrl)).then(
                (error) => {
                    settled = true
                    return error
                },
            )
            await flushPromises()
            if (failure !== 'close-never-settles') {
                vi.advanceTimersByTime(DATABASE_ROLE_POLICY.queryTimeoutMs)
                await flushPromises()
                expect(cancel).toHaveBeenCalledTimes(1)
            }
            expect(close).toHaveBeenCalledWith({ timeout: 0 })
            expect(settled).toBe(false)
            vi.advanceTimersByTime(DATABASE_ROLE_POLICY.cleanupTimeoutMs - 1)
            await flushPromises()
            expect(settled).toBe(false)
            vi.advanceTimersByTime(1)
            expectSafeFailure(await result)
            if (failure !== 'close-never-settles') query.reject(driverFailure)
            else query.resolve(validRows)
            if (failure !== 'query-does-not-drain')
                closing.reject(driverFailure)
            else closing.resolve()
            await flushPromises()
            expect(vi.getTimerCount()).toBe(0)
        },
    )
})
