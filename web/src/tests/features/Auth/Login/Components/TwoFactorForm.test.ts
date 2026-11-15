import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TwoFactorFormProps } from '@/features/Auth/Login/Types/login-component-props.types.ts'

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

import TwoFactorForm from '@/features/Auth/Login/Components/TwoFactorForm.tsx'

const defaultProps: TwoFactorFormProps = {
    code: ['', '', '', '', '', ''],
    isLoading: false,
    isError: false,
    trustThisDevice: false,
    onSubmit: () => {},
    onChange: () => {},
    setRef: () => {},
    onTrustThisDeviceChange: () => {},
    onBackToLogin: () => {},
}

function renderForm(props: Partial<TwoFactorFormProps> = {}) {
    return renderToStaticMarkup(
        createElement(TwoFactorForm, { ...defaultProps, ...props }),
    )
}

describe('TwoFactorForm', () => {
    it('binds six accessible OTP digits to the existing login form', () => {
        const html = renderForm()

        expect(html).toContain('role="group"')
        expect(html).toContain('aria-label="auth.twoFactor.codeLabel"')
        expect(html.match(/inputMode="numeric"/g)).toHaveLength(6)
        expect(html).toContain('autoComplete="one-time-code"')
    })

    it('shows the incomplete-code error on the OTP field', () => {
        const html = renderForm({
            code: ['1', '2', '', '', '', ''],
            isError: true,
        })

        expect(html).toContain('auth.login.twoFactorCodeIncomplete')
        expect(html).toContain('aria-invalid="true"')
    })
})
