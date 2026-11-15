import { getCurrentBrowserPath } from '@/lib/Browser/browser.ts'

const maintenanceReturnPathKey = 'maintenance:return-path'

export function rememberMaintenanceReturnPath(path = getCurrentBrowserPath()) {
    if (typeof window === 'undefined' || !path || path === '/maintenance') {
        return
    }

    window.sessionStorage.setItem(maintenanceReturnPathKey, path)
}

export function getStoredMaintenanceReturnPath() {
    return typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem(maintenanceReturnPathKey)
}

export function clearStoredMaintenanceReturnPath() {
    if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(maintenanceReturnPathKey)
    }
}
