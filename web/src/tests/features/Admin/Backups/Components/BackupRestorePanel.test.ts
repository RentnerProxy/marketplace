import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import BackupRestorePanel, {
    BackupRestoreActions,
} from '@/features/Admin/Backups/Components/BackupRestorePanel.tsx'
import type { BackupRestorePanelProps } from '@/features/Admin/Backups/Types/backup-component-props.types.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
function props(): BackupRestorePanelProps {
    return {
        backupId: 'backup-1',
        state: {
            restoreBackupId: 'backup-1',
            restoreConfirmation: '',
            activeActionId: null,
        },
        handler: {
            handleCancelRestore: mock(),
            handleRestoreConfirmationChange: mock(),
            handleRestoreBackup: mock(),
        },
    }
}

describe('Backup restore confirmation', () => {
    it('renders only for the selected backup and associates warnings with confirmation input', () => {
        const fixture = props()
        expect(BackupRestorePanel({ ...fixture, backupId: 'other' })).toBeNull()
        const tree = BackupRestorePanel(fixture)
        const html = renderToStaticMarkup(tree)
        expect(html).toStartWith('<div')
        expect(html).toContain(
            'admin.backups.restoreWarningPrivateBackgroundCoverage',
        )
        expect(html).toContain('aria-describedby="restore-warning-backup-1"')
        expect(
            findElement(
                BackupRestoreActions(fixture),
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleRestoreBackup,
            ).props.disabled,
        ).toBe(true)
        invoke(
            findElement(
                tree,
                (element) => element.props.placeholder === 'WIEDERHERSTELLEN',
            ),
            'onChange',
            { target: { value: 'WIEDERHERSTELLEN' } },
        )
        expect(
            fixture.handler.handleRestoreConfirmationChange,
        ).toHaveBeenCalledWith('WIEDERHERSTELLEN')
    })

    it('requires exact confirmation and locks restore and cancellation during execution', () => {
        const fixture = props()
        fixture.state.restoreConfirmation = 'WIEDERHERSTELLEN'
        const tree = BackupRestoreActions(fixture)
        const restore = findElement(
            tree,
            (element) =>
                element.props.onClick === fixture.handler.handleRestoreBackup,
        )
        expect(restore.props.disabled).toBe(false)
        invoke(restore, 'onClick')
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleCancelRestore,
            ),
            'onClick',
        )
        expect(fixture.handler.handleRestoreBackup).toHaveBeenCalledTimes(1)
        expect(fixture.handler.handleCancelRestore).toHaveBeenCalledTimes(1)
        fixture.state.activeActionId = 'backup-1'
        const pending = BackupRestoreActions(fixture)
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleRestoreBackup,
            ).props.disabled,
        ).toBe(true)
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleCancelRestore,
            ).props.disabled,
        ).toBe(true)
        expect(
            findElement(
                BackupRestorePanel(fixture),
                (element) => element.props.placeholder === 'WIEDERHERSTELLEN',
            ).props.disabled,
        ).toBe(true)
    })
})
