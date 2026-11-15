import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import BackupSettingsCard from '@/features/Admin/Backups/Components/BackupSettingsCard.tsx'
import BackupScheduleSettings from '@/features/Admin/Backups/Components/BackupScheduleSettings.tsx'
import BackupRetentionSettings from '@/features/Admin/Backups/Components/BackupRetentionSettings.tsx'
import useBackupScheduleSettingsLogic from '@/features/Admin/Backups/Hooks/useBackupScheduleSettingsLogic.ts'
import BackupCreationProgressBridge from '@/features/Admin/Backups/Components/BackupCreationProgressBridge.tsx'
import { settings } from './backupFixtures.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'de', t: (key: string) => key }),
}))
const progressBridge = mock()
mock.module(
    '@/features/Admin/Backups/Hooks/useBackupCreationProgressBridgeLogic.ts',
    () => ({ default: progressBridge }),
)

describe('Backup settings', () => {
    it('wires the automatic switch and save button and blocks pending saves', () => {
        const handler = {
            handleSettingsChange: mock(),
            handleSaveSettings: mock(),
        }
        const tree = BackupSettingsCard({
            state: { settings, isSaving: false },
            handler,
        })
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('admin.backups.settingsDescription')
        expect(html).toContain('admin.backups.scheduleTitle')
        expect(html).toContain('admin.backups.retentionTitle')
        invoke(
            findElement(tree, (element) => element.props.type === 'checkbox'),
            'onChange',
            { target: { checked: true } },
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === handler.handleSaveSettings,
            ),
            'onClick',
        )
        expect(handler.handleSettingsChange).toHaveBeenCalledWith(
            'isEnabled',
            true,
        )
        expect(handler.handleSaveSettings).toHaveBeenCalledTimes(1)
        expect(
            findElement(
                BackupSettingsCard({
                    state: { settings, isSaving: true },
                    handler,
                }),
                (element) =>
                    element.props.onClick === handler.handleSaveSettings,
            ).props.disabled,
        ).toBe(true)
    })

    it.each(['daily', 'weekdays', 'interval-hours', 'interval-weeks'] as const)(
        'renders the controls appropriate for %s and forwards typed changes',
        (scheduleType) => {
            const onSettingsChange = mock()
            const tree = BackupScheduleSettings({
                settings: {
                    ...settings,
                    scheduleType,
                    scheduleHour: 7,
                    scheduleMinute: 5,
                },
                onSettingsChange,
            })
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('admin.backups.scheduleTitle')
            invoke(
                findElement(
                    tree,
                    (element) =>
                        element.props.label === 'admin.backups.scheduleType',
                ),
                'onValueChange',
                'daily',
            )
            expect(onSettingsChange).toHaveBeenCalledWith(
                'scheduleType',
                'daily',
            )
            if (scheduleType !== 'interval-hours') {
                const time = findElement(
                    tree,
                    (element) =>
                        element.props.label === 'admin.backups.scheduleTime',
                )
                expect(time.props.value).toBe('07:05')
                invoke(time, 'onChange', { target: { value: '09:30' } })
                expect(onSettingsChange).toHaveBeenCalledWith('scheduleHour', 9)
                expect(onSettingsChange).toHaveBeenCalledWith(
                    'scheduleMinute',
                    30,
                )
            } else expect(html).not.toContain('admin.backups.scheduleTime')
            if (scheduleType === 'weekdays') {
                const weekdays = elements(tree).filter(
                    (element) => element.type === 'button',
                )
                expect(weekdays).toHaveLength(7)
                invoke(weekdays[0]!, 'onClick')
                invoke(weekdays[5]!, 'onClick')
                expect(onSettingsChange).toHaveBeenCalledWith(
                    'scheduleWeekdays',
                    '2,3,4,5',
                )
                expect(onSettingsChange).toHaveBeenCalledWith(
                    'scheduleWeekdays',
                    '1,2,3,4,5,6',
                )
            }
            if (scheduleType.startsWith('interval-')) {
                const interval = findElement(
                    tree,
                    (element) =>
                        element.props.label ===
                        `admin.backups.${scheduleType === 'interval-hours' ? 'intervalHours' : 'intervalWeeks'}`,
                )
                expect(interval.props.max).toBe(
                    scheduleType === 'interval-hours' ? 168 : 52,
                )
                invoke(interval, 'onChange', { target: { value: '3' } })
                expect(onSettingsChange).toHaveBeenCalledWith(
                    'scheduleInterval',
                    3,
                )
            }
            if (scheduleType === 'interval-weeks') {
                invoke(
                    findElement(
                        tree,
                        (element) =>
                            element.props.label ===
                            'admin.backups.intervalWeekday',
                    ),
                    'onValueChange',
                    '0',
                )
                expect(onSettingsChange).toHaveBeenCalledWith(
                    'scheduleWeekdays',
                    '0',
                )
            }
        },
    )

    it('never removes the final scheduled weekday and sorts additions in calendar order', () => {
        const onSettingsChange = mock()
        const logic = useBackupScheduleSettingsLogic({
            settings: { ...settings, scheduleWeekdays: '5' },
            onSettingsChange,
        })
        logic.handler.handleToggleWeekday(5)
        expect(onSettingsChange).not.toHaveBeenCalled()
        logic.handler.handleToggleWeekday(1)
        expect(onSettingsChange).toHaveBeenCalledWith('scheduleWeekdays', '1,5')
    })

    it.each(['count', 'days', 'both'] as const)(
        'renders %s retention bounds and forwards storage inclusion',
        (retentionMode) => {
            const onSettingsChange = mock()
            const tree = BackupRetentionSettings({
                settings: { ...settings, retentionMode },
                onSettingsChange,
            })
            invoke(
                findElement(
                    tree,
                    (element) =>
                        element.props.label === 'admin.backups.retentionMode',
                ),
                'onValueChange',
                'both',
            )
            expect(onSettingsChange).toHaveBeenCalledWith(
                'retentionMode',
                'both',
            )
            const html = renderToStaticMarkup(tree)
            expect(html.includes('admin.backups.retentionDays')).toBe(
                retentionMode !== 'count',
            )
            expect(html.includes('admin.backups.retentionCount')).toBe(
                retentionMode !== 'days',
            )
            for (const [label, maximum, key] of [
                ['retentionDays', 3650, 'retentionDays'],
                ['retentionCount', 1000, 'retentionCount'],
            ] as const) {
                if (
                    retentionMode ===
                    (key === 'retentionDays' ? 'count' : 'days')
                )
                    continue
                const input = findElement(
                    tree,
                    (element) =>
                        element.props.label === `admin.backups.${label}`,
                )
                expect(input.props).toMatchObject({ min: 1, max: maximum })
                invoke(input, 'onChange', { target: { value: '20' } })
                expect(onSettingsChange).toHaveBeenCalledWith(key, 20)
            }
            invoke(
                findElement(
                    tree,
                    (element) => element.props.type === 'checkbox',
                ),
                'onChange',
                { target: { checked: false } },
            )
            expect(onSettingsChange).toHaveBeenCalledWith(
                'includeStorage',
                false,
            )
        },
    )

    it('mounts the creation progress bridge for the current user without exposing a view', () => {
        expect(BackupCreationProgressBridge({ userId: 'user-1' })).toBeNull()
        expect(progressBridge).toHaveBeenCalledWith('user-1')
    })
})
