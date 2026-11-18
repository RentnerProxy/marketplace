import type {
    BrowserTokenHandoff,
    BrowserTokenHandoffOptions,
    BrowserTokenTransfer,
    TokenHandoffBrowser,
} from './Types/browser-token-handoff.types.ts'

export function createBrowserTokenHandoff(options: BrowserTokenHandoffOptions) {
    const handoffs = new WeakMap<TokenHandoffBrowser, BrowserTokenHandoff>()

    function capture(browser: TokenHandoffBrowser): void {
        if (handoffs.has(browser)) return
        let pending: BrowserTokenTransfer = { status: 'missing' }
        const listeners = new Set<() => void>()
        const replaceState = browser.history.replaceState.bind(browser.history)

        function publish(next: BrowserTokenTransfer) {
            pending = next
            for (const listener of listeners) listener()
        }

        function captureLocation(source: 'initial' | 'navigation') {
            const { pathname, hash, search } = browser.location
            if (!options.isActivePath(pathname)) {
                publish({ status: 'inactive' })
                return
            }
            if (
                source === 'navigation' &&
                !search &&
                options.shouldCaptureFragmentChange?.(hash) === false
            )
                return

            const next = options.parseFragment(hash)
            if (hash || search) {
                try {
                    replaceState(
                        browser.history.state,
                        '',
                        options.canonicalPath,
                    )
                } catch {
                    pending = { status: 'invalid' }
                    throw new Error(options.clearUrlError)
                }
            }
            publish(next)
        }

        const handoff: BrowserTokenHandoff = {
            take() {
                const next = pending
                pending = { status: 'missing' }
                return next
            },
            discard() {
                publish({ status: 'inactive' })
            },
            subscribe(listener) {
                listeners.add(listener)
                return function () {
                    listeners.delete(listener)
                    queueMicrotask(function () {
                        if (listeners.size === 0)
                            pending = { status: 'missing' }
                    })
                }
            },
        }
        captureLocation('initial')
        handoffs.set(browser, handoff)
        browser.addEventListener(
            'popstate',
            () => captureLocation('navigation'),
            { capture: true },
        )
        browser.addEventListener(
            'hashchange',
            function () {
                if (browser.location.hash) captureLocation('navigation')
            },
            { capture: true },
        )
    }

    return {
        capture,
        get(
            this: void,
            browser: TokenHandoffBrowser,
        ): BrowserTokenHandoff | undefined {
            return handoffs.get(browser)
        },
        discard(this: void, browser: TokenHandoffBrowser): void {
            handoffs.get(browser)?.discard()
        },
    }
}
