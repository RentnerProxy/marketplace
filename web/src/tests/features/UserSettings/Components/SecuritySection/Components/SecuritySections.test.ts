import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PasskeySection from '@/features/UserSettings/Components/SecuritySection/Components/PasskeySection.tsx'
import PasswordResetSection from '@/features/UserSettings/Components/SecuritySection/Components/PasswordResetSection.tsx'
import TwoFactorSection from '@/features/UserSettings/Components/SecuritySection/Components/TwoFactorSection.tsx'
import ReauthenticationInput from '@/features/UserSettings/Components/SecuritySection/Components/ReauthenticationInput.tsx'
import SecurityChangeLoginNotice from '@/features/UserSettings/Components/SecuritySection/Components/SecurityChangeLoginNotice.tsx'
import type usePasskeyLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasskeyLogic.ts'
import type usePasswordResetLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasswordResetLogic.ts'
import type useTwoFactorLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let passkey: ReturnType<typeof usePasskeyLogic>
let password: ReturnType<typeof usePasswordResetLogic>
let twoFactor: ReturnType<typeof useTwoFactorLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Hooks/usePasskeyLogic.ts',
    () => ({ default: () => passkey }),
)
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Hooks/usePasswordResetLogic.ts',
    () => ({ default: () => password }),
)
mock.module(
    '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts',
    () => ({ default: () => twoFactor }),
)
mock.module('@tanstack/react-router', () => ({
    Link: ({ to, children }: { to: string; children: ReactNode }) =>
        createElement('a', { href: to }, children),
}))

beforeEach(() => {
    passkey = {
        state: {
            deletingPasskeyId: null,
            isAddingPasskey: false,
            isDeletingPasskey: false,
            isLoadingPasskeys: false,
            isLoadingReauthenticationMethod: false,
            isReauthenticationReady: true,
            isReauthenticationRequired: false,
            passkeys: [],
            reauthenticationMethod: 'password',
            reauthenticationValue: '',
        },
        handler: {
            handleAddPasskey: mock(),
            handleDeletePasskey: mock(),
            handleReauthenticationValueChange: mock(),
        },
    }
    password = {
        state: { isRequestingPasswordReset: false },
        handler: { handleRequestPasswordReset: mock() },
    }
    twoFactor = {
        state: {
            copySecret: false,
            isConfirmingTwoFactorSetup: false,
            isDisablingTwoFactor: false,
            isLoadingTwoFactorStatus: false,
            isStartingTwoFactorSetup: false,
            isTwoFactorBusy: false,
            isTwoFactorEnabled: false,
            isReauthenticationRequired: false,
            isTwoFactorSetupPending: false,
            twoFactorOtpAuthUrl: null,
            twoFactorReauthenticationValue: '',
            twoFactorSecret: null,
            twoFactorToken: '',
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
})

describe('Security sections', () => {
    it.each([false, true])(
        'configures reauthentication input for totp=%s with associated description',
        (isTotp) => {
            const onChange = mock()
            const tree = ReauthenticationInput({
                id: 'confirm-identity',
                isTotp,
                value: '123',
                disabled: true,
                onChange,
            })
            const input = findElement(
                tree,
                (element) => element.type === 'input',
            )
            expect(input.props).toMatchObject({
                type: isTotp ? 'text' : 'password',
                inputMode: isTotp ? 'numeric' : 'text',
                autoComplete: isTotp ? 'one-time-code' : 'current-password',
                maxLength: isTotp ? 6 : 1024,
                disabled: true,
                'aria-describedby': 'confirm-identity-description',
            })
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('for="confirm-identity"')
            expect(html).toContain('id="confirm-identity-description"')
            invoke(input, 'onChange', { target: { value: '654321' } })
            expect(onChange).toHaveBeenCalledWith('654321')
        },
    )

    it('announces that all devices need a new login and links to sign in', () => {
        const html = renderToStaticMarkup(SecurityChangeLoginNotice())
        expect(html).toContain('role="status"')
        expect(html).toContain('userSettings.security.signInAgainAllDevices')
        expect(html).toContain('href="/login"')
    })

    it('offers password reset then disables the request button during sending', () => {
        const tree = PasswordResetSection()
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    password.handler.handleRequestPasswordReset,
            ),
            'onClick',
        )
        expect(
            password.handler.handleRequestPasswordReset,
        ).toHaveBeenCalledTimes(1)
        expect(renderToStaticMarkup(tree)).toContain(
            'userSettings.security.passwordReset',
        )
        password.state.isRequestingPasswordReset = true
        const pending = PasswordResetSection()
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick ===
                    password.handler.handleRequestPasswordReset,
            ).props.disabled,
        ).toBe(true)
        expect(renderToStaticMarkup(pending)).toContain(
            'userSettings.security.passwordSending',
        )
    })

    it('offers 2FA enrollment with password reauthentication and a pending state', () => {
        const tree = TwoFactorSection()
        expect(renderToStaticMarkup(tree)).toContain(
            'userSettings.security.2faEnable',
        )
        const reauthentication = findElement(
            tree,
            (element) =>
                element.props.id === 'enable-two-factor-reauthentication',
        )
        expect(reauthentication.props.isTotp).toBe(false)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    twoFactor.handler.handleStartTwoFactorSetup,
            ),
            'onClick',
        )
        expect(
            twoFactor.handler.handleStartTwoFactorSetup,
        ).toHaveBeenCalledTimes(1)
        twoFactor.state.isStartingTwoFactorSetup = true
        twoFactor.state.isTwoFactorBusy = true
        const pending = TwoFactorSection()
        expect(renderToStaticMarkup(pending)).toContain(
            'userSettings.security.2faPreparing',
        )
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick ===
                    twoFactor.handler.handleStartTwoFactorSetup,
            ).props.disabled,
        ).toBe(true)
    })

    it('requires totp for disabling active 2FA and blocks actions during reauthentication', () => {
        twoFactor.state.isTwoFactorEnabled = true
        const tree = TwoFactorSection()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('userSettings.security.2faActive')
        expect(
            findElement(
                tree,
                (element) =>
                    element.props.id === 'disable-two-factor-reauthentication',
            ).props.isTotp,
        ).toBe(true)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    twoFactor.handler.handleDisableTwoFactor,
            ),
            'onClick',
        )
        expect(twoFactor.handler.handleDisableTwoFactor).toHaveBeenCalledTimes(
            1,
        )
        twoFactor.state.isDisablingTwoFactor = true
        twoFactor.state.isReauthenticationRequired = true
        twoFactor.state.isTwoFactorReauthenticationReady = false
        const pending = TwoFactorSection()
        expect(renderToStaticMarkup(pending)).toContain(
            'userSettings.security.2faDisabling',
        )
        expect(renderToStaticMarkup(pending)).toContain(
            'userSettings.security.signInAgainAllDevices',
        )
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick ===
                    twoFactor.handler.handleDisableTwoFactor,
            ).props.disabled,
        ).toBe(true)
    })

    it('replaces enrollment controls with the returned setup panel', () => {
        twoFactor.state.twoFactorOtpAuthUrl = 'otpauth://totp/Test?secret=TEST'
        const html = renderToStaticMarkup(TwoFactorSection())
        expect(html).toContain('userSettings.security.2faScan')
        expect(html).not.toContain('id="enable-two-factor-reauthentication"')
    })

    it('renders passkey loading and empty states and forwards add with password confirmation', () => {
        const tree = PasskeySection()
        expect(renderToStaticMarkup(tree)).toContain(
            'userSettings.security.passkeysEmpty',
        )
        expect(
            findElement(
                tree,
                (element) => element.props.id === 'passkey-reauthentication',
            ).props.isTotp,
        ).toBe(false)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === passkey.handler.handleAddPasskey,
            ),
            'onClick',
        )
        expect(passkey.handler.handleAddPasskey).toHaveBeenCalledTimes(1)
        passkey.state.isLoadingPasskeys = true
        expect(renderToStaticMarkup(PasskeySection())).toContain(
            'userSettings.security.passkeysLoading',
        )
    })

    it('renders passkey names, backup and last-use metadata and deletes the chosen credential', () => {
        passkey.state.passkeys = [
            {
                id: 'key-1',
                name: 'Laptop',
                deviceType: 'multiDevice',
                backedUp: true,
                createdAt: '2026-01-01T12:00:00Z',
                lastUsedAt: '2026-02-01T12:00:00Z',
            },
            {
                id: 'key-2',
                name: 'Security key',
                deviceType: 'singleDevice',
                backedUp: false,
                createdAt: '2026-01-02T12:00:00Z',
                lastUsedAt: null,
            },
        ]
        passkey.state.reauthenticationMethod = 'totp'
        const tree = PasskeySection()
        const html = renderToStaticMarkup(tree)
        for (const text of [
            'Laptop',
            'Security key',
            'userSettings.security.passkeyBackedUp',
            'userSettings.security.passkeySingleDevice',
            'userSettings.security.passkeyCreatedAt',
            'userSettings.security.passkeyLastUsedAt',
        ])
            expect(html).toContain(text)
        const remove = elements(tree).filter(
            (element) => element.type === 'button',
        )
        expect(remove).toHaveLength(2)
        invoke(remove[1]!, 'onClick')
        expect(passkey.handler.handleDeletePasskey).toHaveBeenCalledWith(
            'key-2',
        )
        passkey.state.isDeletingPasskey = true
        passkey.state.deletingPasskeyId = 'key-2'
        passkey.state.isReauthenticationRequired = true
        const pending = PasskeySection()
        expect(renderToStaticMarkup(pending)).toContain(
            'userSettings.security.signInAgainAllDevices',
        )
        expect(
            elements(pending)
                .filter((element) => element.type === 'button')
                .every((element) => element.props.disabled),
        ).toBe(true)
        passkey.state.isAddingPasskey = true
        expect(renderToStaticMarkup(PasskeySection())).toContain(
            'userSettings.security.passkeyAdding',
        )
    })
})
