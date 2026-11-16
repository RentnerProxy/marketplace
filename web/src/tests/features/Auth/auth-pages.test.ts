import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PASSWORD_POLICY } from '@/config/security.config.ts'
import { registrationInputSchema } from '@/features/Auth/Register/validation.ts'
import type { CreateFirstSuperUserAccountLogicReturn } from '@/features/Auth/FirstSuperUser/Types/first-super-user-form.types.ts'
import type { PasswordResetClientPhase } from '@/lib/Auth/PasswordReset/Types/password-reset-controller.types.ts'

const submit = vi.fn()
const change = vi.fn()
const values: Record<string, string> = { username: 'starter-admin', email: '' }

function Field({
    name,
    children,
}: {
    name: string
    children: (field: {
        name: string
        state: { value: string }
        handleChange: (value: string) => void
    }) => ReactNode
}) {
    return children({
        name,
        state: { value: values[name] ?? '' },
        handleChange: (value) => change(name, value),
    })
}

const loginState = {
    isLoading: false,
    isPasskeyLoading: false,
    requiresTwoFactor: false,
    twoFactorCode: ['', '', '', '', '', ''],
    trustThisDevice: false,
    isTwoFactorError: false,
}
const resetState: { phase: PasswordResetClientPhase; isLoading: boolean } = {
    phase: 'ready',
    isLoading: false,
}
const forgotState = { isLoading: false }
const registerState = {
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
    isSocial: false,
    isPending: false,
    error: '',
    phase: 'form',
}
vi.mock('@/features/Auth/Register/Hooks/useRegisterLogic.ts', () => ({
    default: () => ({
        state: registerState,
        handler: {
            handleSubmit: submit,
            handleVerify: submit,
            handleCancelSocial: submit,
        },
        setter: {
            setUsername: change,
            setEmail: change,
            setPassword: change,
            setConfirmPassword: change,
            setAcceptTerms: change,
        },
    }),
}))
vi.mock('@/shared/Auth/Components/SocialLogin.tsx', () => ({
    default: () => null,
}))
vi.mock('@/layouts/PublicLayout/Components/LanguageSwitcher.tsx', () => ({
    default: () => createElement('button', { type: 'button' }, 'Language'),
}))
const setupState: CreateFirstSuperUserAccountLogicReturn['state'] = {
    setupAccessState: 'granted',
    isCreating: false,
    formValues: {
        username: 'starter-admin',
        email: 'admin@example.test',
        password: '',
        confirmPassword: '',
        firstName: 'Ada',
        lastName: 'Tester',
        street: 'Teststraße',
        houseNumber: '12',
        postalCode: '12345',
        city: 'Teststadt',
    },
}
const headerState = {
    companyName: 'Test Workspace',
    hasCustomLogo: false,
    logoSrc: '/custom-logo.webp',
}

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        children,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
        createElement('a', { ...props, href: to }, children),
}))
vi.mock('@/shared/AddressFormFields/index.tsx', () => ({
    default: ({ values: address }: { values: { city: string } }) =>
        createElement('output', null, address.city),
}))
vi.mock('@/features/Auth/Login/Hooks/useLoginLogic.ts', () => ({
    default: () => ({
        state: loginState,
        form: { Field },
        handler: {
            handleSubmit: submit,
            handlePasskeyLogin: submit,
            handleTwoFactorSubmit: submit,
            handleTwoFactorChange: change,
            handleTwoFactorRef: change,
            handleBackToLogin: submit,
        },
        setter: { setTrustThisDevice: change },
    }),
}))
vi.mock('@/features/Auth/Login/Hooks/useLoginHeaderLogic.ts', () => ({
    default: () => ({ state: headerState }),
}))
vi.mock(
    '@/features/Auth/ForgotPassword/Hooks/usePasswordForgotLogic.ts',
    () => ({
        default: () => ({
            state: forgotState,
            handler: { handleSubmit: submit },
            form: { Field },
        }),
    }),
)
vi.mock('@/features/Auth/PasswordReset/Hooks/usePasswordResetLogic.ts', () => ({
    default: () => ({
        state: resetState,
        handler: { handleSubmit: submit, handleRetryValidation: submit },
        form: { Field },
    }),
}))
vi.mock(
    '@/features/Auth/FirstSuperUser/Hooks/useCreateFirstSuperUserAccountLogic.ts',
    () => ({
        default: () => ({
            state: setupState,
            handler: { handleSubmit: submit },
            setter: { setFieldValue: change },
        }),
    }),
)

import Login from '@/features/Auth/Login/index.tsx'
import Register from '@/features/Auth/Register/index.tsx'
import ForgotPassword from '@/features/Auth/ForgotPassword/index.tsx'
import PasswordReset from '@/features/Auth/PasswordReset/index.tsx'
import Setup from '@/features/Auth/FirstSuperUser/index.tsx'
import Privacy from '@/features/Auth/Privacy/index.tsx'
import Terms from '@/features/Auth/Terms/index.tsx'

beforeEach(function () {
    vi.clearAllMocks()
    Object.assign(loginState, {
        isLoading: false,
        isPasskeyLoading: false,
        requiresTwoFactor: false,
        trustThisDevice: false,
        isTwoFactorError: false,
    })
    Object.assign(resetState, { phase: 'ready', isLoading: false })
    Object.assign(setupState, {
        setupAccessState: 'granted',
        isCreating: false,
    })
    forgotState.isLoading = false
    Object.assign(registerState, {
        isSocial: false,
        isPending: false,
        phase: 'form',
        error: '',
    })
    headerState.hasCustomLogo = false
    headerState.logoSrc = '/rentnerproxy-logo.png'
})

describe('authentication page states', function () {
    it('enforces the username character allowlist with a browser-compatible pattern', function () {
        const html = renderToStaticMarkup(createElement(Register))
        const input = html.match(
            /<input\b[^>]*\bid="register-username"[^>]*>/,
        )?.[0]
        const pattern = input?.match(/\bpattern="([^"]+)"/)?.[1]
        expect(pattern).toBeDefined()
        const constraint = new RegExp(`^(?:${pattern})$`, 'v')
        for (const username of [
            'abc',
            'Alice_123',
            'abc-123',
            '-abc-',
            '___',
            'abc!',
            'a b',
            'äbc',
            'abc/123',
            'abc[123]',
            'foo|bar',
        ]) {
            expect(constraint.test(username)).toBe(
                registrationInputSchema.shape.username.safeParse(username)
                    .success,
            )
        }
    })

    it.each([Login, Register])(
        'keeps a single main landmark, skip link and legal navigation in the auth shell',
        function (Page) {
            const html = renderToStaticMarkup(createElement(Page))
            expect(html.match(/<main\b/g)).toHaveLength(1)
            expect(html.match(/<h1\b/g)).toHaveLength(1)
            expect(html).toContain('href="#main-content"')
            expect(html).toContain('id="main-content"')
            expect(html).toContain('href="/imprint"')
            expect(html).toContain('href="/privacy"')
            expect(html).toContain('Language')
        },
    )

    it('renders registration credentials, confirmation and required legal consent', function () {
        const html = renderToStaticMarkup(createElement(Register))
        expect(html).toContain('auth.register.confirmPassword')
        expect(html).toContain('name="acceptTerms"')
        expect(html).toContain('href="/terms"')
        expect(html).toContain('href="/privacy"')
        expect(html).toContain('type="email"')
        expect(html).toContain('type="password"')
        expect(html).toContain('href="/login"')
        expect(html).toContain('<form')
        expect(html).toContain('name="password"')
        const passwordInputs =
            html.match(/<input\b[^>]*type="password"[^>]*>/g) ?? []
        expect(passwordInputs).toHaveLength(2)
        expect(
            passwordInputs.every((input) => input.includes('minLength="4"')),
        ).toBe(true)
        expect(submit).not.toHaveBeenCalled()
        expect(change).not.toHaveBeenCalled()
    })

    it('renders credentials, recovery and passkey choices with default branding', function () {
        const html = renderToStaticMarkup(createElement(Login))
        expect(html).toContain('Test Workspace')
        expect(html).toContain('value="starter-admin"')
        expect(html).toContain('type="password"')
        expect(html).toContain('href="/forgot-password"')
        expect(html).toContain('href="/register"')
        expect(html).not.toContain('/custom-logo.webp')
    })

    it('hides password fields during provider registration and prevents pending edits', function () {
        Object.assign(registerState, { isSocial: true, isPending: true })
        const html = renderToStaticMarkup(createElement(Register))
        expect(html).toContain('auth.register.socialDetails')
        expect(html).toContain('<fieldset disabled=""')
        expect(html).not.toContain('name="password"')
        expect(html).toContain('name="username"')
        expect(html).toContain('name="acceptTerms"')
    })

    it.each(['verify', 'inbox', 'complete'])(
        'renders the registration %s state without credential inputs',
        (phase) => {
            registerState.phase = phase
            const html = renderToStaticMarkup(createElement(Register))
            expect(html).not.toContain('name="password"')
            expect(html).toContain(
                phase === 'verify'
                    ? 'auth.register.verifyDescription'
                    : phase === 'inbox'
                      ? 'auth.register.checkInbox'
                      : 'auth.register.complete',
            )
            expect(html).toContain('href="/login"')
        },
    )

    it('shows custom branding and independent pending labels', function () {
        headerState.hasCustomLogo = true
        headerState.logoSrc = '/custom-logo.webp'
        loginState.isLoading = true
        loginState.isPasskeyLoading = true
        const html = renderToStaticMarkup(createElement(Login))
        expect(html).toContain('/custom-logo.webp')
        expect(html).toContain('alt="Test Workspace"')
        expect(html).toContain('auth.login.loggingIn')
        expect(html).toContain('auth.login.passkeyLoggingIn')
        expect(html.match(/disabled=""/g)).toHaveLength(2)
    })

    it('replaces credential controls with the two-factor challenge', function () {
        loginState.requiresTwoFactor = true
        loginState.isTwoFactorError = true
        loginState.trustThisDevice = true
        const html = renderToStaticMarkup(createElement(Login))
        expect(html).toContain('auth.twoFactor.title')
        expect(html.match(/<h1\b/g)).toHaveLength(1)
        expect(html).toContain('auth.login.twoFactorCodeIncomplete')
        expect(html).toContain('type="checkbox"')
        expect(html).toContain('checked=""')
        expect(html).not.toContain('href="/forgot-password"')
        expect(html).not.toContain('type="password"')
    })

    it.each([false, true])(
        'keeps recovery navigation while a request is pending=%s',
        function (pending) {
            forgotState.isLoading = pending
            const html = renderToStaticMarkup(createElement(ForgotPassword))
            expect(html).toContain('type="email"')
            expect(html).toContain('required=""')
            expect(html).toContain('href="/login"')
            expect(html).toContain(
                pending
                    ? 'auth.forgotPassword.requesting'
                    : 'auth.forgotPassword.requestLink',
            )
            expect(html.includes('disabled=""')).toBe(pending)
        },
    )

    it.each(['checking', 'unavailable'] as const)(
        'hides password entry while validation is %s',
        function (phase) {
            resetState.phase = phase
            const html = renderToStaticMarkup(createElement(PasswordReset))
            expect(html).toContain('role="status"')
            expect(html).not.toContain('type="password"')
            expect(html).toContain(
                phase === 'unavailable'
                    ? 'auth.passwordReset.retryValidation'
                    : 'auth.passwordReset.validating',
            )
        },
    )

    it.each([false, true])(
        'renders both password fields with the policy and submitting=%s',
        function (pending) {
            resetState.phase = pending ? 'submitting' : 'ready'
            resetState.isLoading = pending
            const html = renderToStaticMarkup(createElement(PasswordReset))
            expect(html.match(/type="password"/g)).toHaveLength(2)
            expect(html).toContain(
                `minLength="${PASSWORD_POLICY.minimumNewLength}"`,
            )
            expect(html).toContain(
                `maxLength="${PASSWORD_POLICY.maximumLength}"`,
            )
            expect(html).toContain('aria-describedby="reset-password-policy"')
            expect(html).toContain('href="/login"')
            expect(html).toContain(
                pending
                    ? 'auth.passwordReset.saving'
                    : 'auth.passwordReset.save',
            )
        },
    )

    it.each(['checking', 'missing'] as const)(
        'keeps first-user inputs hidden until setup access is granted (%s)',
        function (phase) {
            setupState.setupAccessState = phase
            const html = renderToStaticMarkup(createElement(Setup))
            expect(html).toContain('<main')
            expect(html).not.toContain('<form')
            expect(html).not.toContain('admin@example.test')
            expect(html).toContain(
                phase === 'checking'
                    ? 'auth.firstSetup.checkingSetupLink'
                    : 'auth.firstSetup.setupLinkRequired',
            )
        },
    )

    it.each([false, true])(
        'renders initial account/personal data and protects pending submissions=%s',
        function (pending) {
            setupState.isCreating = pending
            const html = renderToStaticMarkup(createElement(Setup))
            expect(html).toContain('<form')
            expect(html).toContain('admin@example.test')
            expect(html).toContain('value="Ada"')
            expect(html).toContain('Teststadt')
            expect(html).toContain('first-setup-password-policy')
            expect(html).toContain(
                pending ? 'auth.firstSetup.creating' : 'auth.firstSetup.create',
            )
            expect(html.includes('disabled=""')).toBe(pending)
        },
    )

    it.each([
        {
            Component: Privacy,
            title: 'Privacy',
            content: 'session_id',
        },
        {
            Component: Terms,
            title: 'Legal notice',
            content: 'Kevin Sträßler',
        },
    ])(
        'renders the public legal page $title',
        function ({ Component, title, content }) {
            const html = renderToStaticMarkup(createElement(Component))
            expect(html).toContain(title)
            expect(html).toContain(content)
        },
    )
})
