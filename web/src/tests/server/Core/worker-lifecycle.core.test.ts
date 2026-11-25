import { expect, it } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function removeTestDirectory(directory: string) {
    const resolved = path.resolve(directory)
    if (
        path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith('core-worker-cli-test-')
    )
        throw new Error('Unsichere synthetische Testablage.')
    await rm(resolved, { recursive: true, force: true })
}

it('beendet eine natürliche Bun-CLI mit unbenutztem Core-Pool und bereinigt dessen private Ablage', async () => {
    const directory = await mkdtemp(
        path.join(tmpdir(), 'core-worker-cli-test-'),
    )
    const program = `
        import { mock } from 'bun:test'
        import * as filesystem from 'node:fs/promises'
        const actual = { ...filesystem }
        const directories = []
        mock.module('node:fs/promises', () => ({
            ...actual,
            async mkdtemp(prefix, ...options) {
                const directory = await actual.mkdtemp(prefix, ...options)
                if (prefix.endsWith('marketplace-core-worker-')) directories.push(directory)
                return directory
            },
        }))
        mock.module('@/server/Logging/logger.ts', () => ({ logInfo() {}, logWarn() {}, logError() {} }))
        const { runCoreCommandService } = await import('@/server/Core/command.service.ts')
        for (let count = 0; count < 3; count++) {
            await runCoreCommandService('storage', { operation: 'permissions', path: ${JSON.stringify(directory)} })
        }
        console.log(JSON.stringify({ completed: true, directories }))
    `
    const participant = Bun.spawn(
        [process.execPath, '--no-env-file', '-e', program],
        {
            cwd: process.cwd(),
            env: { ...process.env, CORE_STORAGE_FFI: 'disabled' },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    let timedOut = false
    // This lifecycle watchdog expires before the five-second idle TTL; no caller shutdown is provided.
    const watchdog = setTimeout(() => {
        timedOut = true
        participant.kill('SIGKILL')
    }, 2000)
    try {
        const [stdout, stderr, exit] = await Promise.all([
            new Response(participant.stdout).text(),
            new Response(participant.stderr).text(),
            participant.exited,
        ])
        expect(stderr).toBe('')
        expect(timedOut).toBe(false)
        expect(exit).toBe(0)
        const completion = JSON.parse(stdout) as {
            completed: boolean
            directories: string[]
        }
        expect(completion.completed).toBe(true)
        expect(completion.directories).toHaveLength(1)
        await expect(stat(completion.directories[0]!)).rejects.toMatchObject({
            code: 'ENOENT',
        })
    } finally {
        clearTimeout(watchdog)
        participant.kill('SIGKILL')
        await participant.exited
        await removeTestDirectory(directory)
    }
})
