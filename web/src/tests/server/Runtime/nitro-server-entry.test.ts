import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'bun:test'
import { build, createNitro } from 'nitro/builder'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import viteConfig from '../../../../../vite.config.ts'

it('passes the production body and idle limits to the internal Bun listener', async function () {
    const { preset, serverEntry } = viteConfig.nitro ?? {}
    expect(preset).toBe('bun')
    if (typeof serverEntry !== 'string')
        throw new Error('Missing Nitro server entry')

    const rootDir = await mkdtemp(join(tmpdir(), 'nitro-bun-limits-'))
    try {
        const nitro = await createNitro({
            rootDir,
            preset,
            serverEntry: resolve(serverEntry),
            alias: { '@': resolve('web/src') },
            logLevel: 0,
        })
        try {
            await build(nitro)
            const entry = join(nitro.options.output.serverDir, 'index.mjs')
            const probe = `
                const serve = Bun.serve
                let server
                Bun.serve = (options) => {
                    const { maxRequestBodySize, idleTimeout } = options
                    console.log(JSON.stringify({ maxRequestBodySize, idleTimeout }))
                    server = serve(options)
                    return server
                }
                await import(process.argv[1])
                await server.stop(true)
            `
            const result = Bun.spawnSync(
                [process.execPath, '--no-env-file', '-e', probe, entry],
                {
                    cwd: rootDir,
                    env: {
                        NODE_ENV: 'production',
                        HOST: '127.0.0.1',
                        PORT: '0',
                    },
                    timeout: 5_000,
                },
            )
            expect(result.exitCode, result.stderr.toString()).toBe(0)
            expect(result.stdout.toString()).toContain(
                JSON.stringify({
                    maxRequestBodySize: BACKUP_LIMITS.maxArchiveBytes,
                    idleTimeout: 60,
                }),
            )
        } finally {
            await nitro.close()
        }
    } finally {
        await rm(rootDir, { recursive: true, force: true })
    }
}, 30_000)
