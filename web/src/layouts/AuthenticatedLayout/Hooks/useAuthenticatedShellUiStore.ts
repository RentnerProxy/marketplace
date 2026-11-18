import { useSyncExternalStore } from 'react'
import type {
    AuthenticatedShellUiState,
    AuthenticatedShellUiStateUpdater,
} from '../Types/authenticated-layout-logic.types.ts'

const subscribers = new Set<() => void>()
let state: AuthenticatedShellUiState = {
    isCollapsed: false,
    isMaintenanceBannerMinimized: false,
    isUserSettingsOpen: false,
    openGroups: {},
}

function emitChange() {
    subscribers.forEach((subscriber) => subscriber())
}

function setState(updater: AuthenticatedShellUiStateUpdater) {
    const nextPartial = typeof updater === 'function' ? updater(state) : updater

    state = {
        ...state,
        ...nextPartial,
    }
    emitChange()
}

function subscribe(subscriber: () => void) {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
}

function getSnapshot() {
    return state
}

function closeUserSettings() {
    setState({ isUserSettingsOpen: false })
}

function openUserSettings() {
    setState({ isUserSettingsOpen: true })
}

function toggleCollapse() {
    setState((current) => ({
        isCollapsed: !current.isCollapsed,
    }))
}

function expandMaintenanceBanner() {
    setState({ isMaintenanceBannerMinimized: false })
}

function minimizeMaintenanceBanner() {
    setState({ isMaintenanceBannerMinimized: true })
}

function toggleGroup(labelKey: string, expandCollapsedSidebar = true) {
    setState((current) => ({
        isCollapsed: current.isCollapsed && !expandCollapsedSidebar,
        openGroups: {
            ...current.openGroups,
            [labelKey]:
                (current.isCollapsed && expandCollapsedSidebar) ||
                !(current.openGroups[labelKey] ?? true),
        },
    }))
}

export default function useAuthenticatedShellUiStore() {
    const uiState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    return {
        state: uiState,
        handler: {
            closeUserSettings,
            expandMaintenanceBanner,
            minimizeMaintenanceBanner,
            openUserSettings,
            toggleCollapse,
            toggleGroup,
        },
    }
}
