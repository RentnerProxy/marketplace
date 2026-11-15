import { describe, expect, it, vi } from 'bun:test'
import {
    captureFirstSetupToken,
    discardFirstSetupToken,
    getFirstSetupTokenHandoff,
} from '@/lib/Auth/FirstSuperUser/firstSetupTokenHandoff.ts'
import {
    getSetupAccessTokenFromFragment,
    isFirstSuperUserSetupPath,
} from '@/features/Auth/FirstSuperUser/setupAccess.ts'
import { createResetTestBrowser as createSetupTestBrowser } from '@/tests/features/Auth/PasswordReset/password-reset.test.helpers.ts'

const fixtureToken = 'A'.repeat(43)

describe('private first setup token handoff', function () {
    it('captures once before URL consumers and preserves native history state', function () {
        const { browser, writes } = createSetupTestBrowser(
            '/setup?access=ignored#access=' + fixtureToken,
        )
        const initialState = browser.history.state
        captureFirstSetupToken(browser)
        const handoff = getFirstSetupTokenHandoff(browser)
        const wrappedHistory = vi.fn()
        browser.history.replaceState = wrappedHistory
        captureFirstSetupToken(browser)

        expect(writes).toHaveLength(1)
        expect(writes[0]?.state).toBe(initialState)
        expect(browser.history.state).toBe(initialState)
        expect(browser.location.pathname).toBe('/setup')
        expect(browser.location.search).toBe('')
        expect(browser.location.hash).toBe('')
        const transfer = handoff?.take()
        expect(transfer?.status).toBe('captured')
        expect(
            transfer?.status === 'captured' && transfer.token === fixtureToken,
        ).toBe(true)
        expect(handoff?.take()).toEqual({ status: 'missing' })
        expect(wrappedHistory).not.toHaveBeenCalled()

        browser.location.hash = '#access=' + 'B'.repeat(43)
        browser.dispatchEvent(new Event('hashchange'))
        expect(wrappedHistory).not.toHaveBeenCalled()
        expect(writes).toHaveLength(2)
        expect(browser.location.hash).toBe('')
        expect(handoff?.take().status).toBe('captured')
    })

    it.each([
        '/setup',
        '/SETUP',
        '/Setup/',
        '/s%65tup',
        '//setup',
        '///%73etup///',
        '/setup////',
    ])('captures and canonicalizes the setup alias %s', function (pathname) {
        const { browser } = createSetupTestBrowser(
            pathname + '#access=' + fixtureToken,
        )
        expect(isFirstSuperUserSetupPath(pathname)).toBe(true)
        captureFirstSetupToken(browser)
        expect(browser.location.pathname).toBe('/setup')
        expect(browser.location.hash).toBe('')
        expect(getFirstSetupTokenHandoff(browser)?.take().status).toBe(
            'captured',
        )
    })

    it.each([
        '/setup/extra',
        '/setup%2F',
        '/%2Fsetup',
        '/%2573etup',
        '/%',
        '/se%ZZtup',
    ])('does not accept another or undecodable path %s', function (pathname) {
        const { browser, writes } = createSetupTestBrowser(
            pathname + '#access=' + fixtureToken,
        )
        expect(isFirstSuperUserSetupPath(pathname)).toBe(false)
        captureFirstSetupToken(browser)
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'inactive',
        })
        expect(writes).toHaveLength(0)
    })

    it.each([
        '#access=' + fixtureToken + '\n',
        '#access=' + fixtureToken + '\r',
        '#access=' + fixtureToken + '\r\n',
        '#access=' + fixtureToken + '&extra=1',
        '#access=' + fixtureToken + '&access=' + fixtureToken,
        '#access=' + '%41'.repeat(43),
        '#access=' + 'A'.repeat(42),
        '#access=' + 'A'.repeat(44),
        '#access=' + 'A'.repeat(42) + '+',
        '?access=' + fixtureToken,
        '#token=' + fixtureToken,
    ])(
        'rejects malformed fragment case %# without decoding',
        function (fragment) {
            expect(getSetupAccessTokenFromFragment(fragment)).toBeNull()
        },
    )

    it('strips an unaccepted query token without granting access', function () {
        const { browser } = createSetupTestBrowser(
            '/setup?access=' + fixtureToken,
        )
        captureFirstSetupToken(browser)
        expect(browser.location.search).toBe('')
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'missing',
        })
    })

    it('strips an invalid fragment without storing it', function () {
        const { browser } = createSetupTestBrowser('/setup#access=invalid')
        captureFirstSetupToken(browser)
        expect(browser.location.hash).toBe('')
        expect(getFirstSetupTokenHandoff(browser)?.take()).toEqual({
            status: 'invalid',
        })
    })

    it('retains an unconsumed transfer through StrictMode and clears a real unmount', async function () {
        const { browser } = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        )
        captureFirstSetupToken(browser)
        const handoff = getFirstSetupTokenHandoff(browser)
        const firstCleanup = handoff?.subscribe(function () {})
        firstCleanup?.()
        const finalCleanup = handoff?.subscribe(function () {})
        await Promise.resolve()
        expect(handoff?.take().status).toBe('captured')

        browser.location.hash = '#access=' + fixtureToken
        browser.dispatchEvent(new Event('hashchange'))
        finalCleanup?.()
        await Promise.resolve()
        expect(handoff?.take()).toEqual({ status: 'missing' })
    })

    it('synchronously notifies on replacement and leaving the setup route', function () {
        const { browser } = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        )
        captureFirstSetupToken(browser)
        const handoff = getFirstSetupTokenHandoff(browser)
        handoff?.take()
        const listener = vi.fn()
        const unsubscribe = handoff?.subscribe(listener)
        browser.location.hash = '#access=' + 'B'.repeat(43)
        browser.dispatchEvent(new Event('popstate'))
        expect(listener).toHaveBeenCalledTimes(1)
        browser.dispatchEvent(new Event('hashchange'))
        expect(listener).toHaveBeenCalledTimes(1)
        discardFirstSetupToken(browser)
        expect(listener).toHaveBeenCalledTimes(2)
        expect(handoff?.take()).toEqual({ status: 'inactive' })
        unsubscribe?.()
    })

    it('keeps browser instances independent', function () {
        const first = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        ).browser
        const second = createSetupTestBrowser('/setup').browser
        captureFirstSetupToken(first)
        captureFirstSetupToken(second)
        expect(getFirstSetupTokenHandoff(second)?.take()).toEqual({
            status: 'missing',
        })
        expect(getFirstSetupTokenHandoff(first)?.take().status).toBe('captured')
    })

    it('fails before handing off a token if URL removal fails', function () {
        const { browser } = createSetupTestBrowser(
            '/setup#access=' + fixtureToken,
        )
        browser.history.replaceState = function () {
            throw new Error('synthetic history failure')
        }
        expect(() => captureFirstSetupToken(browser)).toThrow(
            'Unable to clear the first setup URL',
        )
        expect(getFirstSetupTokenHandoff(browser)).toBeUndefined()
    })
})
