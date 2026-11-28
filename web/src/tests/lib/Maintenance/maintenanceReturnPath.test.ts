import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getCurrentBrowserPath } from '@/lib/Browser/browser.ts'
import {
    clearStoredMaintenanceReturnPath,
    getStoredMaintenanceReturnPath,
    rememberMaintenanceReturnPath,
} from '@/lib/Maintenance/maintenanceReturnPath.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const storage = new Map<string, string>()
beforeEach(function () {
    storage.clear()
    stubTestGlobal('window', {
        location: {
            pathname: '/admin/users',
            search: '?page=2',
            hash: '#selected',
        },
        sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        },
    })
})
afterEach(restoreTestGlobals)

describe('maintenance return navigation', function () {
    it('remembers the full browser path and removes it after use', function () {
        expect(getCurrentBrowserPath()).toBe('/admin/users?page=2#selected')
        expect(getStoredMaintenanceReturnPath()).toBeNull()
        rememberMaintenanceReturnPath()
        expect(getStoredMaintenanceReturnPath()).toBe(
            '/admin/users?page=2#selected',
        )
        clearStoredMaintenanceReturnPath()
        expect(getStoredMaintenanceReturnPath()).toBeNull()
    })

    it('never replaces a return path with the maintenance page or an empty path', function () {
        rememberMaintenanceReturnPath('/user/catalog')
        rememberMaintenanceReturnPath('/maintenance')
        rememberMaintenanceReturnPath(null)
        expect(getStoredMaintenanceReturnPath()).toBe('/user/catalog')
    })

    it('is safe during server rendering without browser globals', function () {
        stubTestGlobal('window', undefined)
        expect(getCurrentBrowserPath()).toBeNull()
        expect(getStoredMaintenanceReturnPath()).toBeNull()
        expect(() =>
            rememberMaintenanceReturnPath('/admin/users'),
        ).not.toThrow()
        expect(clearStoredMaintenanceReturnPath).not.toThrow()
        expect(storage.size).toBe(0)
    })
})
