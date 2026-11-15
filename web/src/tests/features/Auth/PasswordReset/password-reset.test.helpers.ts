import { createActivityTestClock } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

export function createResetTestBrowser(path: string) {
    const clock = createActivityTestClock()
    let historyState: unknown = {
        __TSR_key: 'synthetic-history',
        __TSR_index: 0,
        preserved: 'state',
    }
    const writes: Array<{ state: unknown; url: string }> = []
    const timers = new Map<number, () => void>()
    let nextTimer = 0
    const browser = Object.assign(new EventTarget(), {
        location: new URL('https://app.example.test' + path),
        history: {
            get state() {
                return historyState
            },
            length: 1,
            replaceState(
                state: unknown,
                _unused: string,
                url?: string | URL | null,
            ) {
                historyState = state
                if (url !== undefined && url !== null) {
                    browser.location = new URL(String(url), browser.location)
                    writes.push({ state, url: String(url) })
                }
            },
            pushState(
                state: unknown,
                unused: string,
                url?: string | URL | null,
            ) {
                browser.history.replaceState(state, unused, url)
            },
            back() {},
            forward() {},
            go() {},
        },
        setTimeout(callback: () => void, delayMs: number) {
            const id = ++nextTimer
            timers.set(
                id,
                clock.schedule(function () {
                    timers.delete(id)
                    callback()
                }, delayMs),
            )
            return id
        },
        clearTimeout(id: number) {
            timers.get(id)?.()
            timers.delete(id)
        },
    })
    return { browser, clock, writes }
}
