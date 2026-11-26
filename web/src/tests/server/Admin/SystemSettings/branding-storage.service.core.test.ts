import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let directory = ''
vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
    getPublicStorageRoot: () => path.join(directory, 'public'),
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo() {},
    logWarn() {},
    logError() {},
}))
const { publishSystemBrandingStorageService: publish } =
    await import('@/server/Admin/SystemSettings/branding-storage.service.ts')
const { closeCoreWorkerPoolsService: close } =
    await import('@/server/Core/worker-pool.service.ts')

function variants(size: number): [Buffer, Buffer, Buffer] {
    const webp = Buffer.alloc(size)
    webp.write('RIFF', 0, 'ascii')
    webp.writeUInt32LE(size - 8, 4)
    webp.write('WEBP', 8, 'ascii')
    const ico = Buffer.alloc(size)
    Buffer.from([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0]).copy(ico)
    ico.writeUInt32LE(size - 22, 14)
    ico.writeUInt32LE(22, 18)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(ico, 22)
    return [webp, Buffer.from(webp), ico]
}

beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'core-binary-branding-'))
})

afterEach(async () => {
    await close()
    const resolved = path.resolve(directory)
    if (
        path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith('core-binary-branding-')
    )
        throw new Error('Unsichere synthetische Testablage.')
    await rm(resolved, { recursive: true, force: true })
})

it('publiziert die vollen 24 MiB als drei begrenzte binäre Varianten ohne veränderte Eingaben', async () => {
    const data = variants(8 * 1024 * 1024)
    await publish(...data)
    await Promise.all(
        [
            'images/system/logo.webp',
            'images/system/logo-64.webp',
            'favicon.ico',
        ].map(async (fileName, index) => {
            const file = path.join(directory, 'public', fileName)
            expect((await readFile(file)).equals(data[index]!)).toBe(true)
            if (process.platform !== 'win32')
                expect((await stat(file)).mode & 0o777).toBe(0o600)
        }),
    )
})

it('prüft auch die letzte Variante vor der ersten Änderung und behält den Kanal für gültige Aufträge', async () => {
    const invalid = variants(30)
    invalid[2][22] = 0
    await expect(publish(...invalid)).rejects.toMatchObject({
        code: 'STORAGE_INVALID',
    })
    await expect(stat(path.join(directory, 'public'))).rejects.toMatchObject({
        code: 'ENOENT',
    })
    const valid = variants(30)
    await publish(...valid)
    expect(
        (await readFile(path.join(directory, 'public/favicon.ico'))).equals(
            valid[2],
        ),
    ).toBe(true)
})
