import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

const connections: Array<EventEmitter> = []
const previousPassword = process.env.VALKEY_PASSWORD
const previousPasswordFile = process.env.VALKEY_PASSWORD_FILE
const requiredEnvironment = vi.fn(() => 'redis://127.0.0.1:9/0')
const warn = vi.fn()
const info = vi.fn()
class TestValkey extends EventEmitter {
    constructor(
        readonly url: string,
        readonly options: unknown,
    ) {
        super()
        connections.push(this)
    }
}
vi.mock('ioredis', () => ({ default: TestValkey }))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: requiredEnvironment,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logInfo: info, logWarn: warn }))
const {
    createDedicatedValkeyConnection,
    getBullMqConnectionOptions,
    getBullMqProducerConnectionOptions,
} = await import('@/server/Valkey/valkey.service.ts')

beforeEach(function () {
    connections.length = 0
    delete process.env.VALKEY_PASSWORD
    delete process.env.VALKEY_PASSWORD_FILE
    vi.clearAllMocks()
    requiredEnvironment.mockReset().mockReturnValue('redis://127.0.0.1:9/0')
})
afterEach(function () {
    connections.forEach((connection) => connection.removeAllListeners())
    if (previousPassword === undefined) delete process.env.VALKEY_PASSWORD
    else process.env.VALKEY_PASSWORD = previousPassword
    if (previousPasswordFile === undefined)
        delete process.env.VALKEY_PASSWORD_FILE
    else process.env.VALKEY_PASSWORD_FILE = previousPasswordFile
})

describe('Valkey connection error handling', function () {
    it('keeps retrying producer connections with capped backoff and bounds individual commands', function () {
        const options = getBullMqProducerConnectionOptions()
        expect(options.maxRetriesPerRequest).toBe(1)
        expect(options.commandTimeout).toBe(3_000)
        expect([1, 3, 4, 10, 100].map(options.retryStrategy)).toEqual([
            200, 600, 800, 2_000, 2_000,
        ])
    })

    it('uses the separate password for direct and queue connections in development', function () {
        process.env.VALKEY_PASSWORD = 'local:p@ss/#% word'
        const connection = createDedicatedValkeyConnection()
        expect(
            new URL((connection as unknown as TestValkey).url).password,
        ).toBe(encodeURIComponent(process.env.VALKEY_PASSWORD))
        expect(getBullMqConnectionOptions()).toMatchObject({
            host: '127.0.0.1',
            port: 9,
            password: process.env.VALKEY_PASSWORD,
        })
    })

    it('handles error events and logs once per outage without private details', function () {
        createDedicatedValkeyConnection()
        const connection = connections.at(0)
        expect(connection).toBeDefined()
        connection?.emit('error', new Error('private-valkey-credential'))
        connection?.emit('error', new Error('private-valkey-credential'))
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('valkey.connection_unavailable')
        expect(JSON.stringify(warn.mock.calls)).not.toContain(
            'private-valkey-credential',
        )
        connection?.emit('ready')
        expect(info).toHaveBeenCalledWith('valkey.connection_restored')
        connection?.emit('error', new Error('offline again'))
        expect(warn).toHaveBeenCalledTimes(2)
    })

    it('does not log a recovery for an initially healthy connection', function () {
        createDedicatedValkeyConnection()
        connections.at(0)?.emit('ready')
        expect(info).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
    })

    it('does not hide missing configuration behind the connection recovery', function () {
        const error = new Error('missing Valkey configuration')
        requiredEnvironment.mockImplementationOnce(function () {
            throw error
        })
        expect(createDedicatedValkeyConnection).toThrow(error)
        expect(connections).toHaveLength(0)
    })
})
