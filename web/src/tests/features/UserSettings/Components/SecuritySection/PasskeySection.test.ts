import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const state = {
    isAddingPasskey: false,
    isDeletingPasskey: false,
    isLoadingPasskeys: false,
    isLoadingReauthenticationMethod: false,
    isReauthenticationReady: false,
    isReauthenticationRequired: false,
    passkeys: [],
    reauthenticationMethod: 'password',
    reauthenticationValue: '',
}
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock(
    '@/features/UserSettings/Components/SecuritySection/Hooks/usePasskeyLogic.ts',
    () => ({
        default: () => ({
            state,
            handler: {
                handleAddPasskey: vi.fn(),
                handleDeletePasskey: vi.fn(),
                handleReauthenticationValueChange: vi.fn(),
            },
        }),
    }),
)

vi.mock(
    '@/features/UserSettings/Components/SecuritySection/Components/SecurityChangeLoginNotice.tsx',
    () => ({
        default: () => null,
    }),
)

import PasskeySection from '@/features/UserSettings/Components/SecuritySection/Components/PasskeySection.tsx'

describe('Bestätigung beim ersten Passkey', () => {
    beforeEach(() => {
        state.isReauthenticationReady = false
        state.isAddingPasskey = false
        state.isReauthenticationRequired = false
    })

    it('zeigt das beschriftete Bestätigungsfeld auch ohne vorhandene Passkeys', () => {
        const html = renderToStaticMarkup(createElement(PasskeySection))
        expect(html).toContain('id="passkey-reauthentication"')
        expect(html).toContain('for="passkey-reauthentication"')
        expect(html).toContain(
            'aria-describedby="passkey-reauthentication-description"',
        )
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)

        state.isReauthenticationReady = true
        expect(renderToStaticMarkup(createElement(PasskeySection))).not.toMatch(
            /<button[^>]*\sdisabled=""/,
        )
    })

    it('sperrt nach bestätigter Faktoränderung auch die erneute Passworteingabe', () => {
        state.isReauthenticationRequired = true
        const html = renderToStaticMarkup(createElement(PasskeySection))
        expect(html).toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })

    it('sperrt während der Registrierung Feld und erneuten Start', () => {
        state.isReauthenticationReady = true
        state.isAddingPasskey = true
        const html = renderToStaticMarkup(createElement(PasskeySection))
        expect(html).toMatch(/<input[^>]*\sdisabled=""/)
        expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    })
})
