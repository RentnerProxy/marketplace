import { expect, it, vi } from 'bun:test'
import backupRequestTimeoutService from '@/server/Runtime/backup-request-timeout.service.ts'

it.each([
    ['POST', '/api/admin/backups/import', true],
    ['GET', '/api/admin/backups/import', false],
    ['GET', '/api/admin/backups/01941f29-7c00-7000-8000-000000000001', true],
    ['HEAD', '/api/admin/backups/01941f29-7c00-7000-8000-000000000001', true],
    ['GET', '/api/admin/backups/download', false],
    ['GET', '/healthz', false],
] as const)(
    'applies the Nitro Bun timeout for %s %s',
    async function (method, path, extended) {
        const hook = vi.fn()
        await backupRequestTimeoutService({
            hooks: { hook },
        } as unknown as Parameters<typeof backupRequestTimeoutService>[0])
        const [name, handleRequest] = hook.mock.calls[0] ?? []
        expect(name).toBe('request')
        if (typeof handleRequest !== 'function')
            throw new Error('Missing Nitro request hook.')

        const timeout = vi.fn()
        const url = new URL(path, 'http://127.0.0.1:3002')
        const req = Object.assign(new Request(url, { method }), {
            runtime: { bun: { server: { timeout } } },
        })
        await handleRequest({ req })
        expect(timeout.mock.calls).toEqual(extended ? [[req, 255]] : [])
    },
)
