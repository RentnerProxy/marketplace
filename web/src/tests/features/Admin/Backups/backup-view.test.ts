import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Backups from '@/features/Admin/Backups/index.tsx'
import type { BackupLogicReturn } from '@/features/Admin/Backups/Types/backup-logic.types.ts'
import { settings, completedRun } from './Components/backupFixtures.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: BackupLogicReturn
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module('@/features/Admin/Backups/Hooks/useBackupsLogic.ts', () => ({
    default: () => logic,
}))

beforeEach(() => {
    logic = {
        state: {
            settings,
            runs: [],
            stats: {
                total: 0,
                successful: 0,
                failed: 0,
                imported: 0,
                restored: 0,
            },
            nextBackupAt: null,
            restoreBackupId: null,
            deleteBackupId: null,
            deleteBackup: undefined,
            restoreConfirmation: '',
            isLoading: false,
            isSaving: false,
            isCreating: false,
            isImporting: false,
            activeActionId: null,
        },
        handler: {
            handleSettingsChange: mock(),
            handleSaveSettings: mock(),
            handleCreateBackup: mock(),
            handleImportBackup: mock(),
            handleDeleteBackup: mock(),
            handleCancelDeleteBackup: mock(),
            handleConfirmDeleteBackup: mock(),
            handleOpenRestore: mock(),
            handleCancelRestore: mock(),
            handleRestoreConfirmationChange: mock(),
            handleRestoreBackup: mock(),
        },
    }
})

describe('Backup administration view', () => {
    it('renders settings and history with an empty-state description', () => {
        const html = renderToStaticMarkup(Backups())
        expect(html).toContain('admin.backups.title')
        expect(html).toContain('admin.backups.settingsTitle')
        expect(html).toContain('admin.backups.historyTitle')
        expect(html).toContain('admin.backups.empty')
    })

    it.each(['sample.enc', 'sample.tanstack-backup.enc'])(
        'forwards manual creation and import of %s and resets the input for repeated selection',
        (fileName) => {
            const tree = Backups()
            invoke(
                findElement(
                    tree,
                    (element) =>
                        element.props.onClick ===
                        logic.handler.handleCreateBackup,
                ),
                'onClick',
            )
            expect(logic.handler.handleCreateBackup).toHaveBeenCalledTimes(1)
            const input = findElement(
                tree,
                (element) => element.props.type === 'file',
            )
            expect(input.props.accept).toBe('.enc,application/octet-stream')
            const file = new File(['synthetic archive'], fileName)
            const target = { files: [file], value: 'selected' }
            invoke(input, 'onChange', { target })
            expect(logic.handler.handleImportBackup).toHaveBeenCalledWith(file)
            expect(target.value).toBe('')
            invoke(input, 'onChange', { target: { files: null, value: '' } })
            expect(logic.handler.handleImportBackup).toHaveBeenCalledWith(null)
            logic.state.isImporting = true
            logic.state.isCreating = true
            const pending = Backups()
            expect(
                findElement(pending, (element) => element.props.type === 'file')
                    .props.disabled,
            ).toBe(true)
            expect(
                findElement(
                    pending,
                    (element) =>
                        element.props.onClick ===
                        logic.handler.handleCreateBackup,
                ).props.disabled,
            ).toBe(true)
            expect(renderToStaticMarkup(pending)).toContain(
                'admin.backups.importing',
            )
        },
    )

    it('passes the requested archive name and pending state into delete confirmation', () => {
        logic.state.deleteBackupId = completedRun.id
        logic.state.deleteBackup = completedRun
        logic.state.activeActionId = completedRun.id
        const modal = findElement(
            Backups(),
            (element) =>
                element.props.onConfirm ===
                logic.handler.handleConfirmDeleteBackup,
        )
        expect(modal.props).toMatchObject({ isOpen: true, isConfirming: true })
        expect(modal.props.question).toContain(completedRun.fileName!)
        invoke(modal, 'onClose')
        invoke(modal, 'onConfirm')
        expect(logic.handler.handleCancelDeleteBackup).toHaveBeenCalledTimes(1)
        expect(logic.handler.handleConfirmDeleteBackup).toHaveBeenCalledTimes(1)
        logic.state.deleteBackup = undefined
        expect(
            findElement(
                Backups(),
                (element) =>
                    element.props.onConfirm ===
                    logic.handler.handleConfirmDeleteBackup,
            ).props.question,
        ).toContain('admin.backups.unknownBackup')
    })
})
