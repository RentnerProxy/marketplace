import { afterEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    captureRestoreReturnPathFromFragment,
    rememberAuthenticatedRestoreUserId,
} from '@/lib/Restore/restoreReturnFragment.ts'
import {
    clearRestoreReturnPath,
    consumePermittedRestoreReturnPath,
    getRestoreReturnPath,
    rememberRestoreReturnPath,
} from '@/lib/Restore/restoreReturnPath.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const PRE_RESTORE_USER_ID = '01912f5e-7b4a-7c3d-8e9f-0123456789ab'

function createWindowMock(hash: string) {
    const storage = new Map<string, string>()
    const location = {
        origin: 'https://app.example.test',
        pathname: '/update-in-progress',
        search: '?source=gate',
        hash,
    }
    const history = {
        state: { navigation: 'restore' },
        replaceState: vi.fn(
            (state: unknown, _title: string, nextPath: string) => {
                const nextUrl = new URL(nextPath, location.origin)
                history.state = state as { navigation: string }
                location.pathname = nextUrl.pathname
                location.search = nextUrl.search
                location.hash = nextUrl.hash
            },
        ),
    }

    return {
        location,
        history,
        sessionStorage: {
            getItem: vi.fn((key: string) => storage.get(key) ?? null),
            removeItem: vi.fn((key: string) => storage.delete(key)),
            setItem: vi.fn((key: string, value: string) => {
                storage.set(key, value)
            }),
        },
    }
}

describe('Restore-Return-Fragment', function () {
    afterEach(function () {
        clearRestoreReturnPath()
        restoreTestGlobals()
    })

    it('übernimmt einen einmal codierten internen Pfad mit der gemerkten Benutzer-ID', function () {
        const returnPath = '/admin/backups?page=2#history'
        const windowMock = createWindowMock(
            `#return=${encodeURIComponent(returnPath)}`,
        )
        stubTestGlobal('window', windowMock)
        rememberAuthenticatedRestoreUserId(PRE_RESTORE_USER_ID)

        expect(captureRestoreReturnPathFromFragment()).toBe(returnPath)
        expect(getRestoreReturnPath()).toBe(returnPath)
        expect(windowMock.history.replaceState).toHaveBeenCalledWith(
            { navigation: 'restore' },
            '',
            '/update-in-progress?source=gate',
        )
        expect(windowMock.location.hash).toBe('')
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBe(returnPath)
        expect(captureRestoreReturnPathFromFragment()).toBeNull()
    })

    it('ignoriert alte Rücksprünge beim Übernehmen eines neuen benutzergebundenen Fragments', function () {
        const windowMock = createWindowMock(
            `#return=${encodeURIComponent('/admin/backups')}`,
        )
        const legacyKey = 'tanstackdummy:restore-return-path:v1'
        windowMock.sessionStorage.setItem(legacyKey, '/admin/users')
        stubTestGlobal('window', windowMock)
        rememberAuthenticatedRestoreUserId(PRE_RESTORE_USER_ID)

        expect(captureRestoreReturnPathFromFragment()).toBe('/admin/backups')
        expect(windowMock.location.hash).toBe('')
        expect(windowMock.sessionStorage.removeItem).not.toHaveBeenCalledWith(
            legacyKey,
        )
        expect(
            consumePermittedRestoreReturnPath({
                currentUserId: PRE_RESTORE_USER_ID,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toBe('/admin/backups')
        expect(windowMock.sessionStorage.getItem(legacyKey)).toBe(
            '/admin/users',
        )
    })

    it('gibt einem vorhandenen Event- oder Polling-Record Vorrang', function () {
        const windowMock = createWindowMock(
            `#return=${encodeURIComponent('/user/dashboard')}`,
        )
        stubTestGlobal('window', windowMock)
        rememberRestoreReturnPath('/admin/backups', PRE_RESTORE_USER_ID)

        expect(captureRestoreReturnPathFromFragment()).toBe('/admin/backups')
        expect(getRestoreReturnPath()).toBe('/admin/backups')
        expect(windowMock.location.hash).toBe('')
    })

    it.each([
        [
            'einen doppelt codierten Pfad',
            encodeURIComponent(encodeURIComponent('/admin/backups')),
        ],
        ['einen API-Pfad', encodeURIComponent('/api/system/restore-status')],
        [
            'einen externen Pfad',
            encodeURIComponent('https://evil.example/path'),
        ],
    ])('verwirft %s und entfernt das Fragment', function (_label, value) {
        const windowMock = createWindowMock(`#return=${value}`)
        stubTestGlobal('window', windowMock)
        rememberAuthenticatedRestoreUserId(PRE_RESTORE_USER_ID)

        expect(captureRestoreReturnPathFromFragment()).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()
        expect(windowMock.location.hash).toBe('')
    })

    it('verwirft den Pfad ohne gemerkte gültige Benutzer-ID', function () {
        const windowMock = createWindowMock(
            `#return=${encodeURIComponent('/admin/backups')}`,
        )
        stubTestGlobal('window', windowMock)
        expect(rememberAuthenticatedRestoreUserId('keine-uuidv7')).toBeNull()

        expect(captureRestoreReturnPathFromFragment()).toBeNull()
        expect(getRestoreReturnPath()).toBeNull()
        expect(windowMock.location.hash).toBe('')
    })
})
