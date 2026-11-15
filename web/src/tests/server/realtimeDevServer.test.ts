import { afterEach, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const events: string[] = []
const setup = vi.fn(async function (_origin: string, signal?: AbortSignal) {
    signal?.addEventListener('abort', () => events.push('setup-stopped'))
    return { stop: vi.fn() }
})
const closeConnections = vi.fn(async () => { events.push('connections-closed') })
const closeDatabase = vi.fn(async () => { events.push('database-closed') })
const disconnect = vi.fn(() => { events.push('subscriber-closed') })
const stopServer = vi.fn(async () => { events.push('server-stopped') })
const server = { stop: stopServer }
const subscriber = vi.fn(async () => ({ disconnect }))

vi.mock('@/db/index.ts', () => ({ db: { $client: { close: closeDatabase } } }))
vi.mock('@/server/Logging/logger.ts', () => ({ logInfo: vi.fn(), logError: vi.fn() }))
vi.mock('@/server/Runtime/app-connections.service.ts', () => ({ closeAppConnectionsService: closeConnections }))
vi.mock('@/server/SystemBootstrap/first-super-user-setup-log.service.ts', () => ({ startFirstSuperUserSetupLogService: setup }))
vi.mock('@/websockets/Server/realtimeServer.ts', () => ({ setRealtimeServer: vi.fn(), handleRealtimePublishBridge: vi.fn() }))
vi.mock('@/websockets/Server/realtimeWebSocket.ts', () => ({ handleRealtimeUpgrade: vi.fn(), realtimeWebSocketHandler: {} }))
vi.mock('@/websockets/Server/realtimeValkey.ts', () => ({ startRealtimeValkeySubscriber: subscriber }))

const previousEnvironment = { ...process.env }
afterEach(function () {
    process.env = previousEnvironment
    vi.restoreAllMocks()
})

it('starts secure setup in the existing dev process and stops it before closing owned resources', async function () {
    process.env.DATABASE_URL = 'postgresql://dev:synthetic@127.0.0.1:5432/unit_test'
    process.env.VALKEY_URL = 'redis://127.0.0.1:6379'
    process.env.ORIGIN = 'http://localhost:3000'
    process.env.NODE_ENV = 'development'
    const signals = new Map<string, () => void>()
    vi.spyOn(process, 'once').mockImplementation(function (event: string | symbol, listener: (...args: never[]) => void) {
        if (event === 'SIGINT' || event === 'SIGTERM') {
            signals.set(event, () => listener())
        }
        return process
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(Bun, 'serve').mockImplementation(() => server as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await import('@/server/realtimeDevServer.ts')

    expect(subscriber).toHaveBeenCalledWith(server)
    expect(setup).toHaveBeenCalledWith('http://localhost:3000', expect.any(AbortSignal))
    signals.get('SIGINT')?.()
    signals.get('SIGTERM')?.()
    await waitForAssertion(() => expect(exit).toHaveBeenCalledWith(0))
    expect(events[0]).toBe('setup-stopped')
    expect(stopServer).toHaveBeenCalledTimes(1)
    expect(closeConnections).toHaveBeenCalledTimes(1)
    expect(closeDatabase).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
})
