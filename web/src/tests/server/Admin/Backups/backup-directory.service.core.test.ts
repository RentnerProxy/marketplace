import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const environment = (function () {
    return {
        values: {} as Record<string, string>,
    }
})()

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function (key: string) {
            const value = environment.values[key]

            if (!value) {
                throw new Error(`Unexpected environment key: ${key}`)
            }

            return value
        },
    }
})

import {
    getBackupFilePath,
    getBackupFilePaths,
    getBackupStoragePaths,
} from '@/server/Admin/Backups/backup-directory.service.ts'

let testRoot = ''

beforeEach(async function () {
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'backup-directory-test-'))
    environment.values = {}
})

afterEach(async function () {
    await rm(testRoot, { force: true, recursive: true })
})

describe('Backup-Ordner mit echtem Rust-Core', function () {
    it('requests private permissions when creating the backup directory', async () => {
        const backupDirectory = path.join(testRoot, 'private-backups')
        environment.values.APP_STORAGE_DIR = path.join(testRoot, 'storage')
        environment.values.BACKUP_DIR = backupDirectory
        await getBackupFilePath('backup.tar')
        if (process.platform !== 'win32') {
            expect((await stat(backupDirectory)).mode & 0o777).toBe(0o700)
        }
    })

    it('verhindert einen Backup-Ordner innerhalb des App-Storage', async function () {
        const storagePath = path.join(testRoot, 'storage')
        environment.values.APP_STORAGE_DIR = storagePath
        environment.values.BACKUP_DIR = path.join(storagePath, 'backups')

        await expect(getBackupFilePath('backup.tar')).rejects.toThrow(
            /innerhalb des App-Storage/,
        )
    })

    it('erzeugt Dateipfade in einem getrennten Backup-Ordner', async function () {
        const backupDirectory = path.join(testRoot, 'backups')
        environment.values.APP_STORAGE_DIR = path.join(testRoot, 'storage')
        environment.values.BACKUP_DIR = backupDirectory

        await expect(getBackupFilePath('backup-1.tar')).resolves.toBe(
            path.join(backupDirectory, 'backup-1.tar'),
        )
    })

    it('bereitet mehrere Pfade gemeinsam vor und liefert Konfiguration ohne Dateizugriff', async function () {
        const backupDirectory = path.join(testRoot, 'backups')
        environment.values.APP_STORAGE_DIR = path.join(testRoot, 'storage')
        environment.values.BACKUP_DIR = backupDirectory
        expect(getBackupStoragePaths()).toEqual({
            backupDirectory,
            storageDirectory: path.join(testRoot, 'storage'),
        })
        await expect(stat(backupDirectory)).rejects.toThrow()
        await expect(getBackupFilePaths(['a.tar', 'b.tar'])).resolves.toEqual([
            path.join(backupDirectory, 'a.tar'),
            path.join(backupDirectory, 'b.tar'),
        ])
    })

    it('verhindert per Symlink einen Backup-Ordner innerhalb des App-Storage', async function () {
        const storagePath = path.join(testRoot, 'storage')
        const storageBackupPath = path.join(storagePath, 'backups')
        const linkedBackupPath = path.join(testRoot, 'linked-backups')
        await mkdir(storageBackupPath, { recursive: true })
        await symlink(
            storageBackupPath,
            linkedBackupPath,
            process.platform === 'win32' ? 'junction' : 'dir',
        )
        environment.values.APP_STORAGE_DIR = storagePath
        environment.values.BACKUP_DIR = linkedBackupPath

        await expect(getBackupFilePath('backup.tar')).rejects.toThrow(
            /innerhalb des App-Storage/,
        )
    })

    it.each([
        '.',
        '..',
        '../backup.tar',
        'unterordner/backup.tar',
        'backup name.tar',
    ])(
        'verwirft einen ungültigen Backup-Dateinamen: %s',
        async function (fileName) {
            environment.values.APP_STORAGE_DIR = path.join(testRoot, 'storage')
            environment.values.BACKUP_DIR = path.join(testRoot, 'backups')

            await expect(getBackupFilePath(fileName)).rejects.toThrow(
                /Ungültiger Backup-Dateiname/,
            )
        },
    )
})
