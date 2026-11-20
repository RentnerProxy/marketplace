import { createElement, isValidElement } from 'react'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import type { BackupRun } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import type { UseBackupTableColumnsParams } from '@/features/Admin/Backups/Components/BackupRunsCard/Types/backup-table.types.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'

let language: 'de' | 'en' = 'de'
const resources = { de, en }

function translate(key: string) {
    let value: unknown = resources[language]
    for (const part of key.split('.')) {
        if (typeof value !== 'object' || value === null || !(part in value)) {
            return key
        }
        value = Reflect.get(value, part)
    }
    return typeof value === 'string' ? value : key
}

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language, t: translate }),
}))
const { default: useBackupTableColumns } =
    await import('@/features/Admin/Backups/Components/BackupRunsCard/Hooks/useBackupTableColumns.tsx')

const onOpenRestore = vi.fn()
const onDeleteBackup = vi.fn()

function getActions(
    backup: BackupRun,
    activeActionId: UseBackupTableColumnsParams['activeActionId'] = null,
) {
    let items: ComponentProps<typeof ActionMenu>['items'] = []
    function Capture() {
        const columns = useBackupTableColumns({
            activeActionId,
            onOpenRestore,
            onDeleteBackup,
        })
        const cell = columns.find((column) => column.id === 'actions')?.cell
        if (typeof cell !== 'function')
            throw new Error('Expected the backup actions cell')
        const output: unknown = Reflect.apply(cell, undefined, [
            { row: { original: backup } },
        ])
        if (output === null) return null
        if (
            !isValidElement<ComponentProps<typeof ActionMenu>>(output) ||
            output.type !== ActionMenu
        )
            throw new Error('Expected the backup action menu')
        items = output.props.items
        return null
    }
    renderToStaticMarkup(createElement(Capture))
    return items
}

function backupRun(fileName: string | null): BackupRun {
    return {
        id: 'synthetic-backup-id',
        trigger: 'manual',
        status: 'completed',
        fileName,
        fileSize: 123,
        includesStorage: false,
        errorMessage: null,
        startedAt: '2030-01-01T00:00:00.000Z',
    }
}

beforeEach(function () {
    language = 'de'
    vi.clearAllMocks()
})

describe('encrypted backup table actions', function () {
    it.each(['de', 'en'] as const)(
        'explains old archives in %s, disables download/restore and retains deletion',
        function (nextLanguage) {
            language = nextLanguage
            const [download, restore, remove] = getActions(
                backupRun('old.tanstack-backup.tar'),
            )
            const description =
                resources[language].admin.backups.encryptedFormatRequired
            expect(download).toMatchObject({ disabled: true, description })
            expect(restore).toMatchObject({ disabled: true, description })
            expect(remove).toMatchObject({ disabled: false, destructive: true })
        },
    )

    it.each(['de', 'en'] as const)(
        'keeps encrypted archive download and restore available in %s',
        function (nextLanguage) {
            language = nextLanguage
            const items = getActions(backupRun('new.tanstack-backup.enc'))
            expect(items[0]).toMatchObject({
                href: '/api/admin/backups/synthetic-backup-id',
                label: resources[language].admin.backups.download,
            })
            expect(
                items.every((item) => !item.disabled && !item.description),
            ).toBe(true)
        },
    )

    it('preserves the existing active-action lock on restore and delete', function () {
        const items = getActions(
            backupRun('new.tanstack-backup.enc'),
            'synthetic-backup-id',
        )
        expect(items.map(({ disabled }) => disabled)).toEqual([
            false,
            true,
            true,
        ])
    })

    it('does not expose actions for a missing filename or unfinished backup', function () {
        expect(getActions(backupRun(null))).toEqual([])
        expect(
            getActions({
                ...backupRun('new.tanstack-backup.enc'),
                status: 'queued',
            }),
        ).toEqual([])
    })
})
