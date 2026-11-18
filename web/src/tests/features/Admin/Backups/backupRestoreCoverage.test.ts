import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import type { BackupRestorePanelProps } from '@/features/Admin/Backups/Types/backup-component-props.types.ts'

const locales = { de, en }
let language: keyof typeof locales = 'de'
function translate(key: string) {
    let value: unknown = locales[language]
    if (value && typeof value === 'object' && key in value) {
        value = Reflect.get(value, key)
    } else {
        for (const part of key.split('.')) {
            if (!value || typeof value !== 'object' || !(part in value))
                return key
            value = Reflect.get(value, part)
        }
    }
    return typeof value === 'string' ? value : key
}
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: translate }),
}))
const { default: BackupRestorePanel } =
    await import('@/features/Admin/Backups/Components/BackupRestorePanel.tsx')
const state = {
    restoreBackupId: 'synthetic-backup',
    restoreConfirmation: '',
    activeActionId: null,
}
const handler = {
    handleCancelRestore() {},
    handleRestoreConfirmationChange() {},
    handleRestoreBackup() {},
}
function render(props: BackupRestorePanelProps) {
    return renderToStaticMarkup(createElement(BackupRestorePanel, props))
}
describe('Historical background restore notice', () => {
    it.each(['de', 'en'] as const)(
        'shows the historical-v2 limitation and complete-v3 behavior in %s before confirmation',
        (selected) => {
            language = selected
            const html = render({
                backupId: 'synthetic-backup',
                state,
                handler,
            })
            expect(html).toContain(
                language === 'de'
                    ? 'Historische Archive mit Manifest v2'
                    : 'Historical archives with manifest v2',
            )
            expect(html).toContain(
                language === 'de'
                    ? 'auch wenn er leer war'
                    : 'including an empty snapshot',
            )
            expect(html).toContain(
                'aria-describedby="restore-warning-synthetic-backup"',
            )
        },
    )
    it('does not add a separate wizard or render a notice for a closed restore row', () => {
        const html = render({
            backupId: 'different-backup',
            state,
            handler,
        })
        expect(html).toBe('')
    })
})
