import { expect, it } from 'bun:test'

it.skipIf(process.platform === 'win32')(
    'beendet den echten Bun-Prozess nach SIGTERM trotz geöffneter Producer- und Valkey-Verbindungen natürlich',
    async function () {
        const ready = Promise.withResolvers<void>()
        const program = `
            import { mock } from 'bun:test'
            mock.module('nitro', () => ({ definePlugin: plugin => plugin }))
            mock.module('@/server/Logging/logger.ts', () => ({ logInfo() {}, logWarn() {}, logError() {} }))
            let connected = 0
            const connectionsReady = Promise.withResolvers()
            // A local TCP peer deliberately never completes the Valkey handshake.
            // No database, cache data or external network is used.
            const peer = Bun.listen({
                hostname: '127.0.0.1', port: 0,
                socket: {
                    open() { if (++connected === 2) connectionsReady.resolve() },
                    data() {},
                },
            })
            process.env.VALKEY_URL = 'redis://127.0.0.1:' + peer.port
            const { getValkeyConnection } = await import('@/server/Valkey/valkey.service.ts')
            const { getBackupQueue } = await import('@/server/Admin/Backups/backup.queue.ts')
            const { default: lifecycle } = await import('@/server/Runtime/core-worker-lifecycle.service.ts')
            let onClose
            lifecycle({ hooks: { hook(name, callback) { if (name === 'close') onClose = callback } } })
            void getValkeyConnection().ping().catch(() => undefined)
            void getValkeyConnection().publish('synthetic-realtime', 'synthetic-event').catch(() => undefined)
            getBackupQueue().on('error', () => undefined)
            process.once('SIGTERM', async () => {
                try {
                    await onClose()
                    peer.stop(true)
                    console.log('app-drained')
                    // No process.exit(): cleanup must release reconnect timers and sockets.
                } catch {
                    peer.stop(true)
                    process.exit(1)
                }
            })
            await connectionsReady.promise
            process.send({ ready: true })
            process.disconnect()
        `
        const participant = Bun.spawn(
            [process.execPath, '--no-env-file', '-e', program],
            {
                cwd: process.cwd(),
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: 'test',
                },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
                ipc(message) {
                    if (
                        typeof message === 'object' &&
                        message !== null &&
                        'ready' in message &&
                        message.ready === true
                    )
                        ready.resolve()
                },
            },
        )
        let timedOut = false
        const watchdog = setTimeout(function () {
            timedOut = true
            ready.reject(
                new Error('Isolierter App-Shutdown überschritt die Testfrist.'),
            )
            participant.kill('SIGKILL')
        }, 5_000)
        try {
            await ready.promise
            participant.kill('SIGTERM')
            const [stdout, stderr, code] = await Promise.all([
                new Response(participant.stdout).text(),
                new Response(participant.stderr).text(),
                participant.exited,
            ])
            expect(timedOut).toBe(false)
            expect(code).toBe(0)
            expect(stdout.trim()).toBe('app-drained')
            expect(stderr).toBe('')
        } finally {
            clearTimeout(watchdog)
            participant.kill('SIGKILL')
            await participant.exited
        }
    },
)
