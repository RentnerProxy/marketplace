import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let directory = ''
function paths() {
    const privateRoot = path.join(directory, 'private')
    const publicRoot = path.join(directory, 'public')
    const backgroundDirectory = path.join(privateRoot, 'images/user/id')
    return {
        absolutePrivateStorageRoot: privateRoot,
        absoluteBackgroundDir: backgroundDirectory,
        absoluteBackground: path.join(backgroundDirectory, 'background.webp'),
        absoluteLegacyBackground: path.join(
            publicRoot,
            'images/user/id/background.webp',
        ),
    }
}

vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
    getPublicStorageRoot: () => path.join(directory, 'public'),
    getUserPublicImagePaths: paths,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo() {},
    logWarn() {},
    logError() {},
}))
const {
    readCurrentUserBackgroundFileService: read,
    statCurrentUserBackgroundFileService: statBackground,
} = await import('@/server/UserSettings/background-storage.service.ts')
const { closeCoreWorkerPoolsService: close } =
    await import('@/server/Core/worker-pool.service.ts')

beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'core-binary-background-'))
    await mkdir(paths().absoluteBackgroundDir, { recursive: true, mode: 0o700 })
    await mkdir(path.dirname(paths().absoluteLegacyBackground), {
        recursive: true,
        mode: 0o700,
    })
})

afterEach(async () => {
    await close()
    const resolved = path.resolve(directory)
    if (
        path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith('core-binary-background-')
    )
        throw new Error('Unsichere synthetische Testablage.')
    await rm(resolved, { recursive: true, force: true })
})

it('liest die vollen 8 MiB binär mit beliebigen Bytes und verwendet denselben Kanal erneut', async () => {
    const data = Buffer.alloc(8 * 1024 * 1024)
    for (let index = 0; index < data.length; index++) data[index] = index % 256
    await writeFile(paths().absoluteBackground, data, { mode: 0o600 })
    const metadata = await statBackground('id')
    if (!metadata) throw new Error('Expected background metadata')
    expect(metadata.size).toBe(data.length)
    const expected = { ...metadata, bytes: data }
    expect(await read('id')).toEqual(expected)
    expect(await read('id')).toEqual(expected)
})

it('unterscheidet eine fehlende Datei von einer vorhandenen leeren Datei', async () => {
    expect(await read('id')).toBeNull()
    expect(await statBackground('id')).toBeNull()
    await writeFile(paths().absoluteBackground, Buffer.alloc(0), {
        mode: 0o600,
    })
    const result = await read('id')
    if (!result) throw new Error('Expected an empty background')
    expect(Buffer.isBuffer(result.bytes)).toBe(true)
    expect(result.bytes).toEqual(Buffer.alloc(0))
    expect(result.size).toBe(0)
    expect(await statBackground('id')).toEqual({
        size: 0,
        version: result.version,
    })
})

it('migriert Legacy-Dateien mit denselben Inhalten und privaten POSIX-Modi', async () => {
    const data = Buffer.from([0, 10, 255, 34, 123])
    await writeFile(paths().absoluteLegacyBackground, data, { mode: 0o600 })
    const metadata = await statBackground('id')
    if (!metadata) throw new Error('Expected migrated background metadata')
    expect(metadata.size).toBe(data.length)
    expect(await read('id')).toEqual({ ...metadata, bytes: data })
    expect(await readFile(paths().absoluteBackground)).toEqual(data)
    await expect(stat(paths().absoluteLegacyBackground)).rejects.toMatchObject({
        code: 'ENOENT',
    })
    if (process.platform !== 'win32') {
        expect((await stat(paths().absoluteBackground)).mode & 0o777).toBe(
            0o600,
        )
        expect((await stat(paths().absoluteBackgroundDir)).mode & 0o777).toBe(
            0o700,
        )
    }
})

it('weist übergroße Dateien zurück und liest danach weiter über einen unveränderten Worker', async () => {
    await writeFile(
        paths().absoluteBackground,
        Buffer.alloc(8 * 1024 * 1024 + 1),
        { mode: 0o600 },
    )
    await expect(read('id')).rejects.toMatchObject({ code: 'STORAGE_INVALID' })
    await expect(statBackground('id')).rejects.toMatchObject({
        code: 'STORAGE_INVALID',
    })
    await writeFile(paths().absoluteBackground, Buffer.from('safe'), {
        mode: 0o600,
    })
    expect((await read('id'))?.bytes).toEqual(Buffer.from('safe'))
})

it.skipIf(process.platform === 'win32')(
    'weist Symlink-Ziele zurück und erhält Dateien außerhalb des privaten Roots',
    async () => {
        const outside = path.join(directory, 'outside')
        await writeFile(outside, 'outside', { mode: 0o600 })
        await symlink(outside, paths().absoluteBackground)
        await expect(read('id')).rejects.toBeDefined()
        await expect(statBackground('id')).rejects.toBeDefined()
        expect(await readFile(outside, 'utf8')).toBe('outside')
    },
)
