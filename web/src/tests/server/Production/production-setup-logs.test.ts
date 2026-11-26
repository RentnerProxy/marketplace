import { afterEach, expect, it, vi } from 'bun:test'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const logGate = Promise.withResolvers<void>()
const childExit = Promise.withResolvers<number>()
const stopSetupLog = vi.fn()
const startSetupLog = vi.fn(async function (_origin: string) {
    await logGate.promise
    return { stop: stopSetupLog }
})
const subscriber = {
    status: 'ready',
    quit: vi.fn(async function () {}),
    disconnect: vi.fn(),
}
const server = { pendingRequests: 0, stop: vi.fn(async function () {}) }
const child = {
    exited: childExit.promise,
    kill: vi.fn(function () {
        childExit.resolve(0)
    }),
}
const syntheticEnvironment = {
    ORIGIN: 'https://app.example.test',
    PORT: '3000',
    INTERNAL_APP_PORT: '3002',
    HOST: '127.0.0.1',
    TRUST_PROXY_HEADERS: 'false',
    CI: 'true',
    TEST: 'true',
    SERVER_SHUTDOWN_TIMEOUT: '5',
}
const previousEnvironment = new Map(
    Object.keys(syntheticEnvironment).map(
        (key) => [key, process.env[key]] as const,
    ),
)
const initialSignalListeners = {
    SIGINT: new Set(process.rawListeners('SIGINT')),
    SIGTERM: new Set(process.rawListeners('SIGTERM')),
}

vi.mock(
    '@/server/SystemBootstrap/first-super-user-setup-log.service.ts',
    () => ({
        startFirstSuperUserSetupLogService: startSetupLog,
    }),
)
vi.mock('@/websockets/Server/realtimeValkey.ts', () => ({
    startRealtimeValkeySubscriber: async function () {
        return subscriber
    },
}))
vi.mock('@/websockets/Server/realtimeServer.ts', () => ({
    setRealtimeServer: vi.fn(),
}))
vi.mock('@/websockets/Server/realtimeWebSocket.ts', () => ({
    realtimeWebSocketHandler: {},
}))
vi.mock('@/server/Production/request-handler.service.ts', () => ({
    createProductionRequestHandlerService: () => () =>
        new Response('synthetic'),
}))

afterEach(function () {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.rawListeners(signal)) {
            if (!initialSignalListeners[signal].has(listener))
                process.removeListener(signal, listener)
        }
    }
    for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    vi.restoreAllMocks()
})

it('starts the setup-log lifecycle in the app process before the child server and stops it on shutdown', async function () {
    Object.assign(process.env, syntheticEnvironment)
    const barrierHealth =
        await import('@/server/Storage/storage-mutation-barrier-health.service.ts')
    const installFatalHandler = vi
        .spyOn(
            barrierHealth,
            'installStorageMutationBarrierFatalExitHandlerService',
        )
        .mockImplementation(function () {})
    vi.spyOn(console, 'log').mockImplementation(function () {})
    const serve = vi
        .spyOn(Bun, 'serve')
        .mockReturnValue(server as unknown as ReturnType<typeof Bun.serve>)
    const spawn = vi
        .spyOn(Bun, 'spawn')
        .mockReturnValue(child as unknown as ReturnType<typeof Bun.spawn>)
    const exit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)
    const starting = import('@/server/productionServer.ts')
    try {
        await waitForAssertion(() => {
            expect(startSetupLog).toHaveBeenCalledWith(
                'https://app.example.test',
            )
        })
        expect(spawn).not.toHaveBeenCalled()
    } finally {
        logGate.resolve()
        await starting
    }

    expect(serve).toHaveBeenCalledTimes(1)
    expect(installFatalHandler).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]?.[0]).toEqual([
        process.execPath,
        '--no-env-file',
        '.output/server/index.mjs',
    ])
    const childEnvironment = spawn.mock.calls[0]?.[1]?.env
    expect(childEnvironment?.SERVER_SHUTDOWN_TIMEOUT).toBe('3660')
    expect(childEnvironment).not.toHaveProperty('CI')
    expect(childEnvironment).not.toHaveProperty('TEST')
    expect(stopSetupLog).not.toHaveBeenCalled()
    const shutdown = process
        .rawListeners('SIGTERM')
        .find((listener) => !initialSignalListeners.SIGTERM.has(listener))
    if (!shutdown)
        throw new Error('Synthetic SIGTERM handler was not installed')
    Reflect.apply(shutdown, process, [])
    await waitForAssertion(() => {
        expect(exit).toHaveBeenCalledWith(0)
    })

    expect(stopSetupLog).toHaveBeenCalledTimes(1)
    expect(server.stop).toHaveBeenCalledWith(true)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(subscriber.quit).toHaveBeenCalledTimes(1)
})
