import { afterEach, describe, expect, it, vi, setSystemTime } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    clearRestoreReturnPath,
    consumePermittedRestoreReturnPath,
    getRestoreReturnPath,
    normalizeRestoreReturnPath,
    rememberRestoreReturnPath,
} from '@/lib/Restore/restoreReturnPath.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const PRE_RESTORE_USER_ID = '01912f5e-7b4a-7c3d-8e9f-0123456789ab'
const OTHER_USER_ID = '01912f5e-7b4a-7c3d-9e9f-0123456789ab'

function createWindowMock() {
    const storage = new Map<string, string>()

    return {
        location: { origin: 'https://app.example.test' },
        sessionStorage: {
            getItem: vi.fn((key: string) => storage.get(key) ?? null),
            removeItem: vi.fn((key: string) => storage.delete(key)),
            setItem: vi.fn((key: string, value: string) => {
                storage.set(key, value)
            }),
        },
    }
}

describe('Restore-Return-Pfad', function () {
    afterEach(function () {
        clearRestoreReturnPath()
        vi.useRealTimers()
        restoreTestGlobals()
    })

    it('speichert einen vollständigen internen Pfad versioniert und konsumiert ihn genau einmal', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        stubTestGlobal('window', createWindowMock())

        expect(
            rememberRestoreReturnPath(
                '/admin/backups?page=2#history',
                PRE_RESTORE_USER_ID,
            ),
        ).toBe('/admin/backups?page=2#history')
        expect(
            rememberRestoreReturnPath(
                '/admin/users?should-not=replace',
                PRE_RESTORE_USER_ID,
            ),
        ).toBe('/admin/backups?page=2#history')
        expect(getRestoreReturnPath()).toBe('/admin/backups?page=2#history')
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBe('/admin/backups?page=2#history')
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBeNull()
    })

    it('liest und entfernt ausschließlich den benutzergebundenen v2-Record', function () {
        const windowMock = createWindowMock()
        const legacyKey = 'tanstackdummy:restore-return-path:v1'
        const currentKey = 'rentnerproxy-marketplace:restore-return-path:v2'
        windowMock.sessionStorage.setItem(legacyKey, '/admin/users')
        stubTestGlobal('window', windowMock)

        expect(getRestoreReturnPath()).toBeNull()
        expect(windowMock.sessionStorage.getItem).toHaveBeenCalledWith(
            currentKey,
        )
        expect(windowMock.sessionStorage.removeItem).not.toHaveBeenCalled()
        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBe('/admin/backups')
        expect(windowMock.sessionStorage.removeItem.mock.calls).toEqual([
            [currentKey],
        ])
        expect(windowMock.sessionStorage.getItem(legacyKey)).toBe(
            '/admin/users',
        )
        expect(getRestoreReturnPath()).toBeNull()
    })

    it('verwirft den Rücksprung einmalig bei einem anderen Benutzer', function () {
        stubTestGlobal('window', createWindowMock())
        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)

        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: OTHER_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()
    })

    it('ersetzt einen alten Record, wenn ein anderer Benutzer den Restore startet', function () {
        stubTestGlobal('window', createWindowMock())
        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)

        expect(rememberRestoreReturnPath('/user/catalog', OTHER_USER_ID)).toBe(
            '/user/catalog',
        )
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: OTHER_USER_ID,
                permissions: [PERMISSIONS.USER_DASHBOARD],
            }),
        ).toBe('/user/catalog')
    })

    it('legt ohne gültige Pre-Restore-Benutzer-ID keinen Rücksprung an', function () {
        stubTestGlobal('window', createWindowMock())

        expect(rememberRestoreReturnPath('/admin/backups', null)).toBeNull()
        expect(
            rememberRestoreReturnPath('/admin/backups', 'kein-uuidv7'),
        ).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()
    })

    it('verwirft Ziele ohne aktuell passende konfigurierte Berechtigung', function () {
        stubTestGlobal('window', createWindowMock())
        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)

        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.USER_DASHBOARD],
            }),
        ).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()

        rememberRestoreReturnPath('/admin/unbekannt', PRE_RESTORE_USER_ID)
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_SUPER_USER],
            }),
        ).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()
    })

    it('lehnt externe, API-, Restore- und mehrdeutige Pfade strikt ab', function () {
        stubTestGlobal('window', createWindowMock())

        expect(
            normalizeRestoreReturnPath('https://evil.example/path'),
        ).toBeNull()
        expect(normalizeRestoreReturnPath('//evil.example/path')).toBeNull()
        expect(normalizeRestoreReturnPath('/\\evil')).toBeNull()
        expect(normalizeRestoreReturnPath('/%5cevil')).toBeNull()
        expect(normalizeRestoreReturnPath('/%255cevil')).toBeNull()
        expect(
            normalizeRestoreReturnPath('/api/system/restore-status'),
        ).toBeNull()
        expect(
            normalizeRestoreReturnPath('/api%2Fsystem/restore-status'),
        ).toBeNull()
        expect(
            normalizeRestoreReturnPath('/api%252Fsystem/restore-status'),
        ).toBeNull()
        expect(normalizeRestoreReturnPath('/update-in-progress')).toBeNull()
        expect(
            normalizeRestoreReturnPath('/update-in-progress%252Fchild'),
        ).toBeNull()
        expect(
            normalizeRestoreReturnPath('/update-in-progress/child'),
        ).toBeNull()
        expect(normalizeRestoreReturnPath('/admin/users\n')).toBeNull()
    })

    it('verwirft einen abgelaufenen Rücksprung', function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
        stubTestGlobal('window', createWindowMock())

        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)
        vi.advanceTimersByTime(24 * 60 * 60_000 + 1)

        expect(getRestoreReturnPath()).toBeNull()
    })
})
