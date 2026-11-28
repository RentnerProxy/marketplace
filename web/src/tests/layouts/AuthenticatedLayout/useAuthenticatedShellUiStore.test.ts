import { describe, expect, it, vi } from 'bun:test'
import useAuthenticatedShellUiStore from '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts'

vi.mock('react', function () {
    return {
        useSyncExternalStore: function (
            subscribe: (subscriber: () => void) => () => void,
            getSnapshot: () => unknown,
        ) {
            subscribe(function () {})
            return getSnapshot()
        },
    }
})

describe('useAuthenticatedShellUiStore', function () {
    it('verwaltet Sidebar, Wartungsbanner, und Gruppen gemeinsam', function () {
        const initialStore = useAuthenticatedShellUiStore()

        expect(initialStore.state).toEqual({
            isCollapsed: false,
            isMaintenanceBannerMinimized: false,
            openGroups: {},
        })

        initialStore.handler.minimizeMaintenanceBanner()
        initialStore.handler.toggleGroup('navigation.admin')

        const updatedStore = useAuthenticatedShellUiStore()

        expect(updatedStore.state).toEqual({
            isCollapsed: false,
            isMaintenanceBannerMinimized: true,
            openGroups: { 'navigation.admin': false },
        })

        updatedStore.handler.expandMaintenanceBanner()
        updatedStore.handler.toggleCollapse()
        updatedStore.handler.toggleGroup('navigation.admin')

        expect(useAuthenticatedShellUiStore().state).toEqual({
            isCollapsed: true,
            isMaintenanceBannerMinimized: false,
            openGroups: { 'navigation.admin': true },
        })

        updatedStore.handler.toggleGroup('navigation.admin')
        expect(useAuthenticatedShellUiStore().state).toMatchObject({
            isCollapsed: true,
            openGroups: { 'navigation.admin': false },
        })
    })
})
