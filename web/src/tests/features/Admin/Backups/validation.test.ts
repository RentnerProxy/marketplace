import { describe, expect, it } from 'bun:test'
import { updateBackupSettingsInputSchema } from '@/features/Admin/Backups/validation.ts'

const validSettings = {
    isEnabled: true,
    scheduleType: 'daily' as const,
    scheduleInterval: 24,
    scheduleWeekdays: '1,2,3,4,5',
    scheduleHour: 2,
    scheduleMinute: 30,
    retentionMode: 'both' as const,
    retentionDays: 30,
    retentionCount: 10,
    includeStorage: true,
}

describe('Backup-Einstellungen-Validierung', function () {
    it('strippt targetKey aus dem Payload eines älteren Clients', function () {
        const result = updateBackupSettingsInputSchema.parse({
            ...validSettings,
            targetKey: 'legacy-nas',
        })

        expect(result).toEqual(validSettings)
    })

    it('behält die Schedule-Grenzen und die Wochentagsprüfung bei', function () {
        expect(
            updateBackupSettingsInputSchema.safeParse({
                ...validSettings,
                scheduleHour: 24,
            }).success,
        ).toBe(false)
        expect(
            updateBackupSettingsInputSchema.safeParse({
                ...validSettings,
                scheduleInterval: 0,
            }).success,
        ).toBe(false)
        expect(
            updateBackupSettingsInputSchema.safeParse({
                ...validSettings,
                scheduleWeekdays: '1,1',
            }).success,
        ).toBe(false)
    })
})
