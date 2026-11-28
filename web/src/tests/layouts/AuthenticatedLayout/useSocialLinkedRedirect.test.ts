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

const success = mock()
const navigate = mock(async (_options: unknown) => {})
const browser = {
    location: { hash: '', pathname: '/user/catalog', search: '?view=all' },
    history: { state: null, replaceState: mock() },
}
mock.module('react', () => hookReact)
mock.module('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
mock.module('@rentnerkev/toasts', () => ({ toast: { success } }))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const { default: useSocialLinkedRedirect } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useSocialLinkedRedirect.ts')

beforeEach(() => {
    resetHooks()
    browser.location.hash = ''
    browser.history.replaceState.mockClear()
    navigate.mockClear()
    success.mockClear()
    stubTestGlobal('window', browser)
})
afterEach(restoreTestGlobals)

describe('social linked redirect', () => {
    it('confirms the link and opens the security tab of the profile', () => {
        browser.location.hash = '#social-linked'
        renderHook(useSocialLinkedRedirect)
        runEffects()
        expect(browser.history.replaceState).toHaveBeenCalledWith(
            null,
            '',
            '/user/catalog?view=all',
        )
        expect(success).toHaveBeenCalledWith(
            'userSettings.security.socialAccounts.linked',
            { title: 'profile.title' },
        )
        expect(navigate).toHaveBeenCalledWith({
            to: '/profile',
            search: { tab: 'security' },
        })
    })

    it('does nothing without the callback fragment', () => {
        renderHook(useSocialLinkedRedirect)
        runEffects()
        expect(browser.history.replaceState).not.toHaveBeenCalled()
        expect(navigate).not.toHaveBeenCalled()
        expect(success).not.toHaveBeenCalled()
    })
})
