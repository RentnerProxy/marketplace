import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type useTwoFactorLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts'

const initialState: ReturnType<typeof useTwoFactorLogic>['state'] = {
    copySecret: false,
    isConfirmingTwoFactorSetup: false,
    isDisablingTwoFactor: false,
    isLoadingTwoFactorStatus: false,
    isStartingTwoFactorSetup: false,
    isTwoFactorBusy: false,
    isReauthenticationRequired: false,
    isTwoFactorEnabled: false,
    isTwoFactorSetupPending: false,
    twoFactorOtpAuthUrl: null,
    twoFactorReauthenticationValue: '',
    twoFactorSecret: null,
    twoFactorToken: '',
    isTwoFactorReauthenticationReady: false,
    reauthenticationMethod: 'password',
}
const state: ReturnType<typeof useTwoFactorLogic>['state'] = { ...initialState }

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock(
    '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts',
    () => ({
        default: () => ({
            state,
            handler: {
                handleConfirmTwoFactorSetup: vi.fn(),
                handleCopySecret: vi.fn(),
                handleDisableTwoFactor: vi.fn(),
                handleStartTwoFactorSetup: vi.fn(),
                handleTwoFactorTokenChange: vi.fn(),
                handleTwoFactorReauthenticationValueChange: vi.fn(),
            },
        }),
    }),
)

import TwoFactorSection from '@/features/UserSettings/Components/SecuritySection/Components/TwoFactorSection.tsx'

describe('Passwortbest\u00E4tigung vor dem 2FA-Setup', () => {
    beforeEach(() => {
        Object.assign(state, initialState)
    })

    it('zeigt vor der Aktivierung ein beschriftetes Passwortfeld', () => {
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).toContain('id="enable-two-factor-reauthentication"')
        expect(html).toContain('for="enable-two-factor-reauthentication"')
        expect(html).toContain(
            'aria-describedby="enable-two-factor-reauthentication-description"',
        )
        expect(html).toContain('type="password"')
        expect(html).toContain('autoComplete="current-password"')
        expect(html).toContain(
            'userSettings.security.reauthenticationPasswordLabel',
        )
        expect(
            html.indexOf('id="enable-two-factor-reauthentication"'),
        ).toBeLessThan(html.indexOf('<button'))
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })

    it('gibt den Start erst mit bereiter Passwortbest\u00E4tigung frei', () => {
        state.isTwoFactorReauthenticationReady = true
        state.twoFactorReauthenticationValue = 'synthetic-password'
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).not.toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
    })

    it('sperrt Eingabe und Start, solange der 2FA-Status geladen wird', () => {
        state.isTwoFactorReauthenticationReady = true
        state.isLoadingTwoFactorStatus = true
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })

    it.each([
        'isStartingTwoFactorSetup',
        'isConfirmingTwoFactorSetup',
        'isDisablingTwoFactor',
    ] as const)('sperrt Eingabe und erneuten Start bei %s', (operation) => {
        state.isTwoFactorReauthenticationReady = true
        state.isTwoFactorBusy = true
        state[operation] = true
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })

    it('verwendet bei bereits aktivem MFA weiterhin den TOTP-Deaktivierungsweg', () => {
        state.isTwoFactorEnabled = true
        state.reauthenticationMethod = 'totp'
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).toContain('id="disable-two-factor-reauthentication"')
        expect(html).toContain('for="disable-two-factor-reauthentication"')
        expect(html).toContain('type="text"')
        expect(html).toContain('autoComplete="one-time-code"')
        expect(html).toContain(
            'userSettings.security.reauthenticationTotpLabel',
        )
        expect(html).not.toContain('id="enable-two-factor-reauthentication"')
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)

        state.isTwoFactorReauthenticationReady = true
        expect(
            renderToStaticMarkup(createElement(TwoFactorSection)),
        ).not.toMatch(/<button[^>]*\sdisabled=""/)
    })

    it('sperrt auch die Deaktivierung w\u00E4hrend einer laufenden 2FA-Aktion', () => {
        state.isTwoFactorEnabled = true
        state.reauthenticationMethod = 'totp'
        state.isTwoFactorReauthenticationReady = true
        state.isTwoFactorBusy = true
        state.isDisablingTwoFactor = true
        const html = renderToStaticMarkup(createElement(TwoFactorSection))

        expect(html).toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })
})
