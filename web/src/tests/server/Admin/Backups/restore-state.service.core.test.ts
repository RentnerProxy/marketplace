import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

const stateMocks = (function () {
    return { backupDirectory: '' }
})()

vi.mock('@/server/Admin/Backups/backup-directory.service.ts', function () {
    return {
        getBackupStoragePaths: function () {
            return {
                backupDirectory: stateMocks.backupDirectory,
                storageDirectory: path.join(
                    stateMocks.backupDirectory,
                    'storage',
                ),
            }
        },
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

import {
    getPublicRestoreStateService,
    getRestoreStateService,
    isRestoreStateActiveService,
    writeRestoreStateService,
} from '@/server/Admin/Backups/restore-state.service.ts'

describe('persistierter Restore-Status', function () {
    beforeEach(async function () {
        stateMocks.backupDirectory = await mkdtemp(
            path.join(os.tmpdir(), 'restore-state-test-'),
        )
    })

    afterEach(async function () {
        await rm(stateMocks.backupDirectory, {
            force: true,
            recursive: true,
        })
    })

    it('ersetzt den Marker atomar und erkennt terminale Zustände', async function () {
        const startedAt = '2026-08-11T10:00:00.000Z'

        await expect(getRestoreStateService()).resolves.toBeNull()
        await writeRestoreStateService({
            status: 'running',
            phase: 'validating',
            percent: 25,
            processedBytes: 25,
            totalBytes: 100,
            startedAt,
            updatedAt: '2026-08-11T10:00:01.000Z',
        })

        await expect(isRestoreStateActiveService()).resolves.toBe(true)
        await writeRestoreStateService({
            status: 'completed',
            phase: 'finalizing',
            percent: 100,
            processedBytes: 0,
            totalBytes: 0,
            startedAt,
            updatedAt: '2026-08-11T10:00:02.000Z',
        })

        await expect(getRestoreStateService()).resolves.toMatchObject({
            version: 1,
            status: 'completed',
            percent: 100,
        })
        await expect(isRestoreStateActiveService()).resolves.toBe(false)
    })

    it('behandelt einen beschädigten oder unbekannten Marker fail-closed', async function () {
        await writeFile(
            path.join(stateMocks.backupDirectory, '.restore-state-v1.json'),
            JSON.stringify({ version: 99, status: 'running' }),
        )

        await expect(getRestoreStateService()).rejects.toThrow(
            'nicht unterstützt',
        )
        await expect(isRestoreStateActiveService()).resolves.toBe(true)
        await expect(getPublicRestoreStateService()).resolves.toMatchObject({
            version: 1,
            status: 'running',
            phase: 'preparing',
            percent: null,
        })
    })

    it('hält einen unvollständigen Rollback dauerhaft gesperrt', async function () {
        await writeRestoreStateService({
            status: 'recovery-required',
            phase: 'rolling-back',
            percent: null,
            processedBytes: 0,
            totalBytes: 0,
            startedAt: '2026-08-11T10:00:00.000Z',
            updatedAt: '2026-08-11T10:00:01.000Z',
        })

        await expect(isRestoreStateActiveService()).resolves.toBe(true)
    })
})
