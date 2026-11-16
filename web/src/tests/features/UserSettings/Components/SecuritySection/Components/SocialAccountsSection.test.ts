import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SocialAccountsLogicReturn } from '@/features/UserSettings/Components/SecuritySection/Types/social-accounts-logic.types.ts'
import {
    elements,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: SocialAccountsLogicReturn
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Hooks/useSocialAccountsLogic.ts',
    () => ({ default: () => logic }),
)
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Components/ReauthenticationInput.tsx',
    () => ({
        default: (props: { disabled: boolean }) =>
            createElement('input', {
                disabled: props.disabled,
                'aria-label': 'confirmation',
            }),
    }),
)
const { default: SocialAccountsSection } =
    await import('@/features/UserSettings/Components/SecuritySection/Components/SocialAccountsSection.tsx')
beforeEach(() => {
    logic = {
        state: {
            providers: [{ id: 'github', name: 'GitHub', isConnected: true }],
            isLoading: false,
            hasLoadError: false,
            isLinking: false,
            isUnlinking: false,
            unlinkingProvider: null,
            canLink: true,
            hasProviders: true,
            reauthenticationMethod: 'password',
            reauthenticationValue: '',
        },
        handler: {
            handleConnect: mock(),
            handleDisconnect: mock(),
            handleReauthenticationValueChange: mock(),
        },
    }
})
describe('Social account disconnect controls', () => {
    it('renders confirmation and a disconnect action even when every provider is linked', () => {
        const tree = SocialAccountsSection()
        const buttons = elements(tree).filter(
            (element) => element.type === 'button',
        )
        expect(buttons).toHaveLength(1)
        const button = buttons[0]
        if (!button) throw new Error('Missing disconnect button')
        invoke(button, 'onClick')
        expect(logic.handler.handleDisconnect).toHaveBeenCalledWith('github')
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('auth.social.disconnect')
        expect(html).toContain('aria-label="confirmation"')
    })
    it('disables actions and confirmation while unlink is pending', () => {
        logic.state.isUnlinking = true
        logic.state.unlinkingProvider = 'github'
        logic.state.canLink = false
        const html = renderToStaticMarkup(createElement(SocialAccountsSection))
        expect(html).toContain('disabled=""')
        expect(html).toContain('animate-spin')
        const button = elements(SocialAccountsSection()).find(
            (element) => element.type === 'button',
        )
        expect(button?.props.disabled).toBe(true)
        expect(html).toContain('<input disabled=""')
    })
})
