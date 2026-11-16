import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const shell = {
    state: { isUserSettingsOpen: true },
    handler: { closeUserSettings: mock(), openUserSettings: mock() },
}
const success = mock()
const browser = {
    location: { hash: '', pathname: '/dashboard', search: '?view=all' },
    history: { state: null, replaceState: mock() },
}
mock.module('@rentnerkev/toasts', () => ({ toast: { success } }))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
let mounted = true
const body = { style: { overflow: 'unset' } }
mock.module('react', () => hookReact)
mock.module(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts',
    () => ({ default: () => shell }),
)
mock.module('@/shared/Hooks/useHasMounted.ts', () => ({
    default: () => mounted,
}))
const { default: useUserSettingsModalLogic } =
    await import('@/features/UserSettings/Hooks/useUserSettingsModalLogic.ts')

beforeEach(() => {
    resetHooks()
    shell.state.isUserSettingsOpen = true
    mounted = true
    body.style.overflow = 'unset'
    stubTestGlobal('document', { body })
    browser.location.hash = ''
    browser.history.replaceState.mockClear()
    shell.handler.openUserSettings.mockClear()
    success.mockClear()
    stubTestGlobal('window', browser)
})
afterEach(restoreTestGlobals)

describe('User settings modal logic', () => {
    it('opens the security tab after social linking and removes the callback fragment', () => {
        browser.location.hash = '#social-linked'
        renderHook(useUserSettingsModalLogic)
        runEffects()
        expect(renderHook(useUserSettingsModalLogic).state.activeTab).toBe(
            'security',
        )
        expect(shell.handler.openUserSettings).toHaveBeenCalledTimes(1)
        expect(browser.history.replaceState).toHaveBeenCalledWith(
            null,
            '',
            '/dashboard?view=all',
        )
        expect(success).toHaveBeenCalledWith(
            'userSettings.security.socialAccounts.linked',
        )
    })
    it('changes tabs and forwards closure while locking body scroll until cleanup', () => {
        const logic = renderHook(useUserSettingsModalLogic)
        expect(logic.state).toEqual({
            activeTab: 'account',
            mounted: true,
            isOpen: true,
        })
        const cleanup = runEffects()
        expect(body.style.overflow).toBe('hidden')
        logic.setter.setActiveTab('security')
        expect(renderHook(useUserSettingsModalLogic).state.activeTab).toBe(
            'security',
        )
        logic.handler.closeUserSettings()
        expect(shell.handler.closeUserSettings).toHaveBeenCalledTimes(1)
        cleanup()
        expect(body.style.overflow).toBe('unset')
    })
    it('keeps scrolling available while closed and reports the mount state', () => {
        shell.state.isUserSettingsOpen = false
        mounted = false
        expect(renderHook(useUserSettingsModalLogic).state).toMatchObject({
            isOpen: false,
            mounted: false,
        })
        const cleanup = runEffects()
        expect(body.style.overflow).toBe('unset')
        cleanup()
    })
})
