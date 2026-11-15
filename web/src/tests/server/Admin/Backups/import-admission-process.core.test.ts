import { afterEach, beforeEach, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let root = ''

beforeEach(async () => {
    root = await mkdtemp(
        path.join(os.tmpdir(), 'backup-admission-process-test-'),
    )
})

afterEach(async () => {
    const resolved = path.resolve(root)
    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('backup-admission-process-test-')
    )
        throw new Error('Unsafe synthetic process cleanup')
    await rm(resolved, { recursive: true, force: true })
})

function startParticipant(command: 'hold' | 'attempt') {
    const program = `
        import { mock } from 'bun:test'
        import * as fileSystem from 'node:fs/promises'
        import path from 'node:path'
        const actual = { ...fileSystem }
        mock.module('node:fs/promises', () => ({
            ...actual,
            statfs: async () => ({ bavail: 2n ** 50n, bsize: 4096n }),
        }))
        mock.module('@/server/Admin/Backups/backup-directory.service.ts', () => ({
            getBackupFilePath: async name => path.join(${JSON.stringify(root)}, name),
        }))
        mock.module('@/server/Logging/logger.ts', () => ({ logError() {}, logInfo() {}, logWarn() {} }))
        const { acquireBackupImportAdmissionService } =
            await import('@/server/Admin/Backups/import-admission.service.ts')
        try {
            const lease = await acquireBackupImportAdmissionService({
                requestSignal: new AbortController().signal,
                maximumUploadBytes: 8,
            })
            if (${JSON.stringify(command)} === 'hold') {
                await actual.writeFile(path.join(lease.temporaryDirectory, 'owned'), 'one writer')
                console.log('held')
                await Bun.stdin.text()
                await actual.rm(path.join(lease.temporaryDirectory, 'owned'))
            }
            await lease.release()
            console.log('released')
        } catch (error) {
            console.error(error.code ?? error.status ?? 'unknown', error.message)
            if(error.status !== 429) console.error(await actual.readdir(path.join(${JSON.stringify(root)}, '.import-admission-v1')).catch(() => []))
            console.log(error.status === 429 ? 'busy' : 'unexpected failure')
            if (error.status !== 429) process.exitCode = 1
        }
    `
    return Bun.spawn([process.execPath, '--no-env-file', '-e', program], {
        cwd: process.cwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
}

it('enforces one admission across independent Bun processes until the owner finishes', async () => {
    const owner = startParticipant('hold')
    let contender: ReturnType<typeof startParticipant> | undefined
    const timeout = setTimeout(() => {
        owner.kill()
        contender?.kill()
    }, 10_000)
    try {
        const reader = owner.stdout.getReader()
        const first = await reader.read()
        expect(new TextDecoder().decode(first.value).trim()).toBe('held')
        contender = startParticipant('attempt')
        expect((await new Response(contender.stdout).text()).trim()).toBe(
            'busy',
        )
        expect(await contender.exited).toBe(0)
        const directories = await readdir(root)
        expect(directories).toHaveLength(1)
        expect(
            await readFile(path.join(root, directories[0]!, 'owned'), 'utf8'),
        ).toBe('one writer')
        owner.stdin.end()
        const remainingChunks: Uint8Array[] = []
        reader.releaseLock()
        await owner.stdout.pipeTo(
            new WritableStream<Uint8Array>({
                write(chunk) {
                    remainingChunks.push(chunk)
                },
            }),
        )
        const ownerOutput = Buffer.concat(remainingChunks)
            .toString('utf8')
            .trim()
        if (ownerOutput !== 'released')
            throw new Error(
                'Admission release failed: ' +
                    (await new Response(owner.stderr).text()),
            )
        expect(ownerOutput).toBe('released')
        expect(await owner.exited).toBe(0)
        expect(await readdir(root)).toEqual([])
        contender = startParticipant('attempt')
        expect((await new Response(contender.stdout).text()).trim()).toBe(
            'released',
        )
        expect(await contender.exited).toBe(0)
    } finally {
        clearTimeout(timeout)
        owner.stdin.end()
        owner.kill()
        contender?.kill()
        await Promise.all([owner.exited, contender?.exited])
    }
}, 15_000)
