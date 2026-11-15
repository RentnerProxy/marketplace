import { describe, expect, it } from 'bun:test'
import { createBrowserHistory } from '@tanstack/react-router'
import { passwordResetConfig } from '@/config/session.config.ts'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import {
    captureResetToken,
    discardPasswordResetToken,
    getPasswordResetTokenHandoff,
    parsePasswordResetFragment,
} from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'
import { createResetTestBrowser } from '@/tests/features/Auth/PasswordReset/password-reset.test.helpers.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

describe('RAM-only password reset fragment handoff', function () {
    it.each([
        'synthetic-token',
        '  synthetic token  ',
        'a+b/#=&ü',
        'x'.repeat(255),
    ])(
        'preserves the existing trimmed token contract for a correctly encoded fragment %#',
        function (token) {
            expect(
                parsePasswordResetFragment(
                    '#token=' + encodeURIComponent(token),
                ),
            ).toEqual({ status: 'captured', token: token.trim() })
        },
    )
    it.each([
        '#token=',
        '#token=%20',
        '#token=%',
        '#token=%C0%AF',
        '#token=x&token=y',
        '#token=x&extra=y',
        '#other=x',
        '?token=x',
        '#token=' + 'x'.repeat(256),
        '#token=' + 'x'.repeat(passwordResetConfig.maximumLegacyQueryLength),
    ])(
        'rejects malformed, ambiguous or overlong fragments %#',
        function (fragment) {
            expect(parsePasswordResetFragment(fragment)).toEqual({
                status: 'invalid',
            })
        },
    )
    it('keeps a missing link distinct from an invalid one', function () {
        expect(parsePasswordResetFragment('')).toEqual({ status: 'missing' })
    })
    it.each([
        '/password-reset',
        '/password-reset/',
        '/Password-Reset',
        '/PASSWORD-RESET/',
        '/%70assword-reset',
        '//password-reset',
        '/password-reset//',
    ])(
        'scrubs %s before a real browser-history instance reads its initial location',
        function (path) {
            const { browser, writes } = createResetTestBrowser(
                path + '?ignored=synthetic#token=synthetic-proof',
            )
            const originalState = browser.history.state
            captureResetToken(browser)
            const history = createBrowserHistory({ window: browser })
            expect(writes).toEqual([
                { state: originalState, url: '/password-reset' },
            ])
            expect(browser.history.state).toBe(originalState)
            expect(history.location.href).toBe('/password-reset')
            expect(history.location.search).toBe('')
            expect(history.location.hash).toBe('')
            expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
                status: 'captured',
                token: 'synthetic-proof',
            })
            expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
                status: 'missing',
            })
            history.destroy()
        },
    )
    it.each([
        '/password-reset/extra',
        '/%2Fpassword-reset',
        '/password-reset%2F',
        '/setup',
    ])('does not reinterpret unrelated path %s', function (path) {
        const { browser, writes } = createResetTestBrowser(
            path + '#token=synthetic-proof',
        )
        captureResetToken(browser)
        expect(isPasswordResetPath(path)).toBe(false)
        expect(writes).toHaveLength(0)
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
    })
    it('never accepts a legacy query token on the client and removes it from router input', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset?token=synthetic-query-proof',
        )
        captureResetToken(browser)
        expect(browser.location.href).toBe(
            'https://app.example.test/password-reset',
        )
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'missing',
        })
    })
    it('does not lose the handoff when router initialization is repeated', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-proof',
        )
        captureResetToken(browser)
        captureResetToken(browser)
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-proof',
        })
    })
    it('scrubs a second native fragment navigation before real history subscribers see it', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-first',
        )
        captureResetToken(browser)
        getPasswordResetTokenHandoff(browser)?.take()
        const history = createBrowserHistory({ window: browser })
        const seen: Array<string> = []
        history.subscribe(({ location }) => seen.push(location.href))
        browser.location.hash = '#token=synthetic-second'
        browser.dispatchEvent(new Event('popstate'))
        browser.dispatchEvent(new Event('hashchange'))
        expect(seen).toEqual(['/password-reset'])
        expect(history.location.hash).toBe('')
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-second',
        })
        history.destroy()
    })
    it('captures a hashchange without duplicating an already scrubbed popstate', function () {
        const { browser } = createResetTestBrowser('/password-reset')
        captureResetToken(browser)
        browser.location.hash = '#token=synthetic-proof'
        browser.dispatchEvent(new Event('hashchange'))
        expect(browser.location.hash).toBe('')
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-proof',
        })
    })
    it('retains a StrictMode handoff for immediate reattachment and discards it after a real unmount', async function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-proof',
        )
        captureResetToken(browser)
        const handoff = getPasswordResetTokenHandoff(browser)
        if (!handoff) throw new Error('Expected a client handoff')
        const stopFirst = handoff.subscribe(function () {})
        stopFirst()
        const stopSecond = handoff.subscribe(function () {})
        await flushSessionActivityTasks()
        expect(handoff.take()).toEqual({
            status: 'captured',
            token: 'synthetic-proof',
        })
        browser.location.hash = '#token=synthetic-next'
        browser.dispatchEvent(new Event('hashchange'))
        stopSecond()
        await flushSessionActivityTasks()
        expect(handoff.take()).toEqual({ status: 'missing' })
    })
    it('forgets RAM tokens when the router leaves the reset route', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-proof',
        )
        captureResetToken(browser)
        discardPasswordResetToken(browser)
        expect(getPasswordResetTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
    })
    it('fails before router creation if browser history cannot be cleared, without exposing the token in the error', function () {
        const { browser } = createResetTestBrowser(
            '/password-reset#token=synthetic-proof',
        )
        browser.history.replaceState = function () {
            throw new Error('synthetic history failure')
        }
        expect(() => captureResetToken(browser)).toThrow(
            'Unable to clear the password reset URL',
        )
        expect(getPasswordResetTokenHandoff(browser)).toBeUndefined()
    })
})
