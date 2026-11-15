import { describe, expect, it, vi } from 'bun:test'
import { createBrowserTokenHandoff } from '@/lib/Auth/TokenHandoff/browserTokenHandoff.ts'
import type { BrowserTokenTransfer } from '@/lib/Auth/TokenHandoff/Types/browser-token-handoff.types.ts'
import { createResetTestBrowser } from '@/tests/features/Auth/PasswordReset/password-reset.test.helpers.ts'

function createTestHandoff(pathname = '/synthetic-auth') {
    return createBrowserTokenHandoff({
        isActivePath: (path) => path === pathname,
        parseFragment: (fragment) =>
            fragment
                ? { status: 'captured', token: fragment.slice(1) }
                : { status: 'missing' },
        canonicalPath: pathname,
        clearUrlError: 'Unable to clear the synthetic auth URL',
    })
}

describe('shared browser token handoff lifecycle', function () {
    it('keeps factories independent on the same browser through native navigation', function () {
        const first = createTestHandoff('/synthetic-first')
        const second = createTestHandoff('/synthetic-second')
        const { browser } = createResetTestBrowser(
            '/synthetic-first#synthetic-first-proof',
        )
        first.capture(browser)
        second.capture(browser)
        second.discard(browser)
        expect(second.get(browser)?.take()).toEqual({ status: 'inactive' })
        expect(first.get(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-first-proof',
        })

        browser.location.pathname = '/synthetic-second'
        browser.location.hash = '#synthetic-second-proof'
        browser.dispatchEvent(new Event('popstate'))
        expect(first.get(browser)?.take()).toEqual({ status: 'inactive' })
        expect(second.get(browser)?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-second-proof',
        })
        expect(browser.location.hash).toBe('')
    })

    it('clears a replacement URL before synchronous handoff consumers can take it', function () {
        const lifecycle = createTestHandoff()
        const { browser } = createResetTestBrowser('/synthetic-auth')
        lifecycle.capture(browser)
        const handoff = lifecycle.get(browser)
        const seen: Array<{
            search: string
            hash: string
            transfer: BrowserTokenTransfer | undefined
        }> = []
        handoff?.subscribe(function () {
            seen.push({
                search: browser.location.search,
                hash: browser.location.hash,
                transfer: handoff.take(),
            })
        })
        browser.location.search = '?ignored=synthetic-query'
        browser.location.hash = '#synthetic-proof'
        browser.dispatchEvent(new Event('hashchange'))
        expect(seen).toEqual([
            {
                search: '',
                hash: '',
                transfer: { status: 'captured', token: 'synthetic-proof' },
            },
        ])
    })

    it('invalidates an existing pending token when later URL removal fails and recovers after sanitizing', function () {
        const lifecycle = createTestHandoff()
        const { browser } = createResetTestBrowser(
            '/synthetic-auth#synthetic-first-proof',
        )
        const replaceState = browser.history.replaceState.bind(browser.history)
        let failRemoval = false
        browser.history.replaceState = function (state, unused, url) {
            if (failRemoval) throw new Error('synthetic history failure')
            replaceState(state, unused, url)
        }
        const addEventListener = vi.spyOn(browser, 'addEventListener')
        lifecycle.capture(browser)
        const handoff = lifecycle.get(browser)
        const listener = vi.fn()
        handoff?.subscribe(listener)
        const popstate = addEventListener.mock.calls.find(
            ([event]) => event === 'popstate',
        )?.[1]
        if (typeof popstate !== 'function')
            throw new Error('Expected a native popstate listener')

        failRemoval = true
        browser.location.hash = '#synthetic-second-proof'
        expect(() => popstate.call(browser, new Event('popstate'))).toThrow(
            'Unable to clear the synthetic auth URL',
        )
        expect(listener).not.toHaveBeenCalled()
        expect(handoff?.take()).toEqual({ status: 'invalid' })
        expect(handoff?.take()).toEqual({ status: 'missing' })

        failRemoval = false
        popstate.call(browser, new Event('popstate'))
        expect(browser.location.hash).toBe('')
        expect(listener).toHaveBeenCalledTimes(1)
        expect(handoff?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-second-proof',
        })
    })

    it('retains pending tokens while another subscriber remains and clears after the last unsubscribe', async function () {
        const lifecycle = createTestHandoff()
        const { browser } = createResetTestBrowser('/synthetic-auth')
        lifecycle.capture(browser)
        const handoff = lifecycle.get(browser)
        const stopFirst = handoff?.subscribe(function () {})
        const stopSecond = handoff?.subscribe(function () {})
        browser.location.hash = '#synthetic-first-proof'
        browser.dispatchEvent(new Event('hashchange'))
        stopFirst?.()
        await Promise.resolve()
        expect(handoff?.take()).toEqual({
            status: 'captured',
            token: 'synthetic-first-proof',
        })

        browser.location.hash = '#synthetic-second-proof'
        browser.dispatchEvent(new Event('hashchange'))
        stopSecond?.()
        await Promise.resolve()
        expect(handoff?.take()).toEqual({ status: 'missing' })
    })
})
