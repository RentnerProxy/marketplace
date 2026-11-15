import { createElement, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import type { BackupRun } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import type { UseBackupTableColumnsParams } from '@/features/Admin/Backups/Components/BackupRunsCard/Types/backup-table.types.ts'

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
vi.mock('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({
        children,
        content,
    }: {
        children: ReactNode
        content: ReactNode
    }) =>
        createElement(
            'span',
            { title: typeof content === 'string' ? content : undefined },
            children,
        ),
}))

const { default: useBackupTableColumns } =
    await import('@/features/Admin/Backups/Components/BackupRunsCard/Hooks/useBackupTableColumns.tsx')

const onOpenRestore = vi.fn()
const onDeleteBackup = vi.fn()

function Actions({
    backup,
    activeActionId = null,
}: {
    backup: BackupRun
    activeActionId?: UseBackupTableColumnsParams['activeActionId']
}) {
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
    if (!isValidElement(output))
        throw new Error('Expected rendered backup actions')
    return output
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
            const html = renderToStaticMarkup(
                createElement(Actions, {
                    backup: backupRun('old.tanstack-backup.tar'),
                }),
            )
            expect(html).toContain(
                resources[language].admin.backups.encryptedFormatRequired,
            )
            expect(html).not.toContain('href=')
            const buttons = html.match(/<button\b[^>]*>/g) ?? []
            expect(buttons).toHaveLength(3)
            expect(buttons[0]).toContain('disabled=""')
            expect(buttons[1]).toContain('disabled=""')
            expect(buttons[2]).not.toContain('disabled=')
            expect(onOpenRestore).not.toHaveBeenCalled()
            expect(onDeleteBackup).not.toHaveBeenCalled()
        },
    )

    it.each(['de', 'en'] as const)(
        'keeps encrypted archive download and restore available in %s',
        function (nextLanguage) {
            language = nextLanguage
            const html = renderToStaticMarkup(
                createElement(Actions, {
                    backup: backupRun('new.tanstack-backup.enc'),
                }),
            )
            expect(html).toContain(
                'href="/api/admin/backups/synthetic-backup-id"',
            )
            expect(html).toContain(resources[language].admin.backups.download)
            expect(html).not.toContain(
                resources[language].admin.backups.encryptedFormatRequired,
            )
            expect(html).not.toContain('disabled=')
        },
    )

    it('preserves the existing active-action lock on restore and delete', function () {
        const html = renderToStaticMarkup(
            createElement(Actions, {
                backup: backupRun('new.tanstack-backup.enc'),
                activeActionId: 'synthetic-backup-id',
            }),
        )
        expect(html.match(/disabled=""/g)).toHaveLength(2)
        expect(html).toContain('href="/api/admin/backups/synthetic-backup-id"')
    })

    it('does not expose actions for a missing filename or unfinished backup', function () {
        expect(
            renderToStaticMarkup(
                createElement(Actions, {
                    backup: backupRun(null),
                }),
            ),
        ).toBe('')
        expect(
            renderToStaticMarkup(
                createElement(Actions, {
                    backup: {
                        ...backupRun('new.tanstack-backup.enc'),
                        status: 'queued',
                    },
                }),
            ),
        ).toBe('')
    })
})
