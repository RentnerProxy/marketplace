import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const environment = { values: {} as Record<string, string> }
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment(key: string) {
        const value = environment.values[key]
        if (!value) throw new Error(`Unexpected environment key: ${key}`)
        return value
    },
}))
const { deleteBackupFilesService } =
    await import('@/server/Admin/Backups/backup-delete.service.ts')
let testRoot = ''
let backupDirectory = ''

beforeEach(async () => {
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'backup-delete-core-'))
    backupDirectory = path.join(testRoot, 'backups')
    environment.values = {
        BACKUP_DIR: backupDirectory,
        APP_STORAGE_DIR: path.join(testRoot, 'storage'),
    }
    await mkdir(backupDirectory)
})

afterEach(async () => {
    if (
        path.dirname(path.resolve(testRoot)) !== path.resolve(os.tmpdir()) ||
        !path.basename(testRoot).startsWith('backup-delete-core-')
    ) {
        throw new Error('Unsichere synthetische Testablage.')
    }
    await rm(testRoot, { recursive: true, force: true })
})

describe('Backup-Löschung mit echtem Rust-Core', () => {
    it('löscht reguläre Dateien und akzeptiert bereits fehlende Dateien', async () => {
        await writeFile(path.join(backupDirectory, 'a.tar'), 'backup')
        await deleteBackupFilesService(['a.tar', 'missing.tar'])
        await expect(
            stat(path.join(backupDirectory, 'a.tar')),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        await deleteBackupFilesService(['a.tar'])
    })

    it.each([
        { names: ['a.tar', '../outside.tar'] },
        { names: ['a.tar', 'a.tar'] },
    ])(
        'verwirft den ganzen ungültigen Auftrag vor einer Löschung: %s',
        async ({ names }) => {
            await writeFile(path.join(backupDirectory, 'a.tar'), 'preserved')
            await expect(deleteBackupFilesService(names)).rejects.toMatchObject(
                { code: 'BACKUP_INVALID_NAME' },
            )
            expect(
                await readFile(path.join(backupDirectory, 'a.tar'), 'utf8'),
            ).toBe('preserved')
        },
    )

    it('verwirft einen Ordner im Auftrag vor der ersten Dateilöschung', async () => {
        await writeFile(path.join(backupDirectory, 'a.tar'), 'preserved')
        await mkdir(path.join(backupDirectory, 'directory'))
        await expect(
            deleteBackupFilesService(['a.tar', 'directory']),
        ).rejects.toThrow()
        expect(
            await readFile(path.join(backupDirectory, 'a.tar'), 'utf8'),
        ).toBe('preserved')
    })

    it.skipIf(process.platform === 'win32')(
        'öffnet ausgetauschte Wurzeln neu und folgt keinen Symlinks',
        async () => {
            const outside = path.join(testRoot, 'outside')
            await mkdir(outside)
            await writeFile(path.join(outside, 'outside.tar'), 'preserved')
            await deleteBackupFilesService([])
            await rename(backupDirectory, path.join(testRoot, 'old-backups'))
            await symlink(outside, backupDirectory, 'dir')
            await expect(
                deleteBackupFilesService(['outside.tar']),
            ).rejects.toThrow()
            expect(
                await readFile(path.join(outside, 'outside.tar'), 'utf8'),
            ).toBe('preserved')
        },
    )
})
