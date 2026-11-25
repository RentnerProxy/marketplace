import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import TwoFactorSetupPanel from '@/features/UserSettings/Components/SecuritySection/Components/TwoFactorSetupPanel.tsx'
import type { TwoFactorSetupPanelProps } from '@/features/UserSettings/Components/SecuritySection/Types/two-factor-component-props.types.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

function props(): TwoFactorSetupPanelProps {
    return {
        state: {
            copySecret: false,
            isConfirmingTwoFactorSetup: false,
            isDisablingTwoFactor: false,
            isLoadingTwoFactorStatus: false,
            isStartingTwoFactorSetup: false,
            isTwoFactorBusy: false,
            isTwoFactorEnabled: false,
            isReauthenticationRequired: false,
            isTwoFactorSetupPending: true,
            twoFactorOtpAuthUrl: 'otpauth://totp/Test?secret=TESTSECRET',
            twoFactorReauthenticationValue: '',
            twoFactorSecret: 'TESTSECRET',
            twoFactorToken: '123456',
            isTwoFactorReauthenticationReady: true,
            reauthenticationMethod: 'password',
        },
        handler: {
            handleConfirmTwoFactorSetup: mock(),
            handleCopySecret: mock(),
            handleDisableTwoFactor: mock(),
            handleStartTwoFactorSetup: mock(),
            handleTwoFactorTokenChange: mock(),
            handleTwoFactorReauthenticationValueChange: mock(),
        },
    }
}

describe('TwoFactorSetupPanel', () => {
    it('keeps the closed panel inert and removes the setup controls and credentials', () => {
        const fixture = props()
        fixture.state.twoFactorOtpAuthUrl = null
        const html = renderToStaticMarkup(TwoFactorSetupPanel(fixture))
        expect(html).toContain('aria-hidden="true" inert="" data-open="false"')
        expect(html).not.toContain('<svg')
        expect(html).not.toContain('<input')
        expect(html).not.toContain('<button')
        expect(html).not.toContain('TESTSECRET')
    })

    it('renders QR setup, secret and numeric token entry and wires confirmation', () => {
        const fixture = props()
        const tree = TwoFactorSetupPanel(fixture)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('aria-hidden="false" data-open="true"')
        expect(html).toContain('<svg')
        expect(html).toContain('TESTSECRET')
        expect(html).toContain('userSettings.security.2faScan')
        const input = findElement(tree, (element) => element.type === 'input')
        expect(input.props).toMatchObject({
            'aria-label': 'auth.twoFactor.codeLabel',
            autoComplete: 'one-time-code',
            inputMode: 'numeric',
            maxLength: 6,
            value: '123456',
        })
        invoke(input, 'onChange', { target: { value: '654321' } })
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleConfirmTwoFactorSetup,
            ),
            'onClick',
        )
        const copyButton = findElement(
            tree,
            (element) =>
                element.props.onClick === fixture.handler.handleCopySecret,
        )
        expect(copyButton.type).toBe('button')
        invoke(copyButton, 'onClick')
        expect(fixture.handler.handleTwoFactorTokenChange).toHaveBeenCalledWith(
            '654321',
        )
        expect(
            fixture.handler.handleConfirmTwoFactorSetup,
        ).toHaveBeenCalledTimes(1)
        expect(fixture.handler.handleCopySecret).toHaveBeenCalledTimes(1)
    })

    it('requires six digits and disables confirmation while checking', () => {
        const fixture = props()
        fixture.state.twoFactorToken = '123'
        expect(
            findElement(
                TwoFactorSetupPanel(fixture),
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleConfirmTwoFactorSetup,
            ).props.disabled,
        ).toBe(true)
        fixture.state.twoFactorToken = '123456'
        fixture.state.isConfirmingTwoFactorSetup = true
        fixture.state.copySecret = true
        const tree = TwoFactorSetupPanel(fixture)
        expect(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    fixture.handler.handleConfirmTwoFactorSetup,
            ).props.disabled,
        ).toBe(true)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('userSettings.security.checking')
        expect(html).toContain('data-copied="true"')
        fixture.state.twoFactorSecret = null
        expect(
            renderToStaticMarkup(TwoFactorSetupPanel(fixture)),
        ).not.toContain('TESTSECRET')
    })
})
