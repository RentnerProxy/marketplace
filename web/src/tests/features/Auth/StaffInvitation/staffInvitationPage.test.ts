import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode, SubmitEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    cleanup,
    render,
    reset,
} from '@/tests/features/Admin/UserManagement/user-management-hooks.test.helpers.ts'
import { createResetTestBrowser } from '@/tests/features/Auth/PasswordReset/password-reset.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { staffInvitationTokenHandoff } from '@/lib/Auth/staffInvitationToken.ts'

const accept = vi.fn()
vi.mock('@/features/Auth/StaffInvitation/middleware.ts', () => ({
    acceptStaffInvitationHandler: accept,
}))
vi.mock('@/shared/Auth/Components/AuthLayout.tsx', () => ({
    default: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/shared/Auth/Components/BackToLoginLink.tsx', () => ({
    default: () => createElement('a', { href: '/login' }, 'Sign in'),
}))
vi.mock('@rentnerkev/inputs', () => ({
    PasswordInput: ({ id, label }: { id: string; label: string }) =>
        createElement('input', { id, type: 'password', 'aria-label': label }),
}))

const { default: StaffInvitationPage } =
    await import('@/features/Auth/StaffInvitation/index.tsx')
const { default: useStaffInvitationLogic } =
    await import('@/features/Auth/StaffInvitation/Hooks/useStaffInvitationLogic.ts')
const token = 'i'.repeat(43)
const password = 'synthetic-password'
const submit = { preventDefault() {} } as SubmitEvent<HTMLFormElement>

function browse(path: string) {
    const { browser } = createResetTestBrowser(path)
    stubTestGlobal('window', browser)
    staffInvitationTokenHandoff.capture(browser)
    return browser
}

function html() {
    return renderToStaticMarkup(render(StaffInvitationPage))
}

function fillPassword(confirm = password) {
    const { setter } = render(useStaffInvitationLogic)
    setter.setPassword(password)
    setter.setConfirmPassword(confirm)
    return render(useStaffInvitationLogic)
}

beforeEach(() => {
    reset()
    accept.mockReset().mockResolvedValue({ success: true })
})
afterEach(() => {
    cleanup()
    restoreTestGlobals()
})

describe('staff invitation page', () => {
    it('clears the fragment, checks confirmation locally, then submits the token and password once', async () => {
        const browser = browse('/staff-invitation/#invite=' + token)
        expect(browser.location.pathname).toBe('/staff-invitation')
        expect(browser.location.hash).toBe('')
        expect(html()).toContain('auth.staffInvitation.checking')
        await Promise.resolve()
        expect(html()).toContain('id="staff-invitation-confirm-password"')
        expect(html()).not.toContain(token)

        fillPassword('different').handler.handleSubmit(submit)
        expect(html()).toContain('auth.register.passwordMismatch')
        expect(accept).not.toHaveBeenCalled()

        const { handler } = fillPassword()
        handler.handleSubmit(submit)
        handler.handleSubmit(submit)
        expect(accept).toHaveBeenCalledTimes(1)
        expect(accept).toHaveBeenCalledWith({ data: { token, password } })
        await Promise.resolve()
        expect(html()).toContain('auth.staffInvitation.complete')
        expect(html()).toContain('href="/login"')
        expect(render(useStaffInvitationLogic).state.password).toBe('')
        render(useStaffInvitationLogic).handler.handleSubmit(submit)
        expect(accept).toHaveBeenCalledTimes(1)
    })

    it.each([
        '/staff-invitation',
        '/staff-invitation?invite=' + token,
        '/staff-invitation#invite=invalid',
    ])(
        'does not expose the form without a valid fragment token',
        async (path) => {
            const browser = browse(path)
            render(useStaffInvitationLogic)
            await Promise.resolve()
            expect(browser.location.search).toBe('')
            expect(html()).toContain('auth.staffInvitation.invalid')
            expect(html()).not.toContain('id="staff-invitation-password"')
        },
    )

    it('allows a retry on a temporary error and then discards the rejected token', async () => {
        browse('/staff-invitation#invite=' + token)
        accept.mockResolvedValueOnce({ success: false, unavailable: true })
        accept.mockResolvedValueOnce({ success: false })
        render(useStaffInvitationLogic)
        await Promise.resolve()
        fillPassword().handler.handleSubmit(submit)
        await Promise.resolve()
        expect(html()).toContain('auth.staffInvitation.failed')
        render(useStaffInvitationLogic).handler.handleSubmit(submit)
        await Promise.resolve()
        expect(html()).toContain('auth.staffInvitation.invalid')
        expect(accept).toHaveBeenCalledTimes(2)
    })
})
