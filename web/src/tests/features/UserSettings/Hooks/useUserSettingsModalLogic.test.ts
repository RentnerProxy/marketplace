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
    handler: { closeUserSettings: mock() },
}
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
})
afterEach(restoreTestGlobals)

describe('User settings modal logic', () => {
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
