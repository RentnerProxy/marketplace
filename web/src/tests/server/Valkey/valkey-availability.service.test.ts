import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const connection = Object.assign(new EventEmitter(), {
    status: 'wait',
    ping: vi.fn(async () => 'PONG'),
})
const getConnection = vi.fn(() => connection)
vi.mock('@/server/Valkey/valkey.service.ts', () => ({
    getValkeyConnection: getConnection,
}))
const { waitForValkeyReadyService } =
    await import('@/server/Valkey/valkey-availability.service.ts')

beforeEach(function () {
    connection.removeAllListeners()
    connection.status = 'wait'
    connection.ping.mockReset().mockResolvedValue('PONG')
    getConnection.mockReset().mockReturnValue(connection)
})
afterEach(function () {
    connection.removeAllListeners()
})

describe('Valkey availability before starting consumers', function () {
    it('continues immediately for an already ready connection', async function () {
        connection.status = 'ready'
        await waitForValkeyReadyService()
        expect(connection.ping).not.toHaveBeenCalled()
        expect(connection.listenerCount('ready')).toBe(0)
    })

    it('starts a lazy connection with PING and removes the temporary listener', async function () {
        await waitForValkeyReadyService()
        expect(connection.ping).toHaveBeenCalledTimes(1)
        expect(connection.listenerCount('ready')).toBe(0)
    })

    it('keeps a failed initial PING pending and continues after recovery', async function () {
        connection.ping.mockRejectedValueOnce(new Error('offline'))
        let completed = false
        const pending = waitForValkeyReadyService().then(function () {
            completed = true
            return undefined
        })
        await Bun.sleep(0)
        expect(completed).toBe(false)
        expect(connection.listenerCount('ready')).toBe(1)
        connection.emit('ready')
        await pending
        expect(completed).toBe(true)
        expect(connection.listenerCount('ready')).toBe(0)
    })

    it('does not treat an unexpected PING result as ready', async function () {
        connection.ping.mockResolvedValueOnce('NOT READY')
        let completed = false
        const pending = waitForValkeyReadyService().then(function () {
            completed = true
            return undefined
        })
        await Bun.sleep(0)
        expect(completed).toBe(false)
        connection.emit('ready')
        await pending
        expect(connection.listenerCount('ready')).toBe(0)
    })

    it('only completes once when ready arrives before the PING response', async function () {
        const gate = Promise.withResolvers<string>()
        connection.ping.mockReturnValueOnce(gate.promise)
        const pending = waitForValkeyReadyService()
        connection.emit('ready')
        await pending
        gate.resolve('PONG')
        await waitForAssertion(function () {
            expect(connection.listenerCount('ready')).toBe(0)
        })
    })

    it('propagates configuration errors instead of waiting indefinitely', async function () {
        const error = new Error('missing Valkey configuration')
        getConnection.mockImplementationOnce(function () {
            throw error
        })
        await expect(waitForValkeyReadyService()).rejects.toBe(error)
        expect(connection.ping).not.toHaveBeenCalled()
    })
})
