import {
    getRestoreReturnPath,
    normalizePreRestoreUserId,
    normalizeRestoreReturnPath,
    rememberRestoreReturnPath,
} from './restoreReturnPath.ts'

const AUTHENTICATED_RESTORE_USER_STORAGE_KEY =
    'rentnerproxy-marketplace:authenticated-restore-user:v1'

export function rememberAuthenticatedRestoreUserId(userId: unknown) {
    if (typeof window === 'undefined') {
        return null
    }

    const normalizedUserId = normalizePreRestoreUserId(userId)

    if (!normalizedUserId) {
        return null
    }

    try {
        window.sessionStorage.setItem(
            AUTHENTICATED_RESTORE_USER_STORAGE_KEY,
            normalizedUserId,
        )
        return normalizedUserId
    } catch {
        return null
    }
}

function getRememberedAuthenticatedRestoreUserId() {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        const storedUserId = window.sessionStorage.getItem(
            AUTHENTICATED_RESTORE_USER_STORAGE_KEY,
        )
        const normalizedUserId = normalizePreRestoreUserId(storedUserId)

        if (storedUserId && !normalizedUserId) {
            window.sessionStorage.removeItem(
                AUTHENTICATED_RESTORE_USER_STORAGE_KEY,
            )
        }

        return normalizedUserId
    } catch {
        return null
    }
}

export function captureRestoreReturnPathFromFragment() {
    if (typeof window === 'undefined') {
        return null
    }

    const fragment = window.location.hash
    const fragmentParams = new URLSearchParams(fragment.replace(/^#/, ''))

    if (!fragmentParams.has('return')) {
        return null
    }

    try {
        const existingReturnPath = getRestoreReturnPath()

        if (existingReturnPath) {
            return existingReturnPath
        }

        const returnValues = fragmentParams.getAll('return')
        const hasOnlyReturnParameter = Array.from(fragmentParams.keys()).every(
            (key) => key === 'return',
        )

        if (returnValues.length !== 1 || !hasOnlyReturnParameter) {
            return null
        }

        const returnPath = normalizeRestoreReturnPath(returnValues[0])
        const preRestoreUserId = getRememberedAuthenticatedRestoreUserId()

        if (!returnPath || !preRestoreUserId) {
            return null
        }

        return rememberRestoreReturnPath(returnPath, preRestoreUserId)
    } finally {
        try {
            window.history.replaceState(
                window.history.state,
                '',
                `${window.location.pathname}${window.location.search}`,
            )
        } catch (error) {
            console.error(
                'Das Restore-Rücksprungfragment konnte nicht aus der URL entfernt werden.',
                error,
            )
        }
    }
}
