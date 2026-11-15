import { vi } from 'bun:test'
import { restoreTestGlobals } from '@/tests/shared/bunTestStubs.ts'

export const i18nextMock = (function () {
    const handlers: Record<string, (value?: string) => void> = {}
    const api = {
        resolvedLanguage: undefined as string | undefined,
        use: vi.fn(),
        init: vi.fn(async function () {}),
        on: vi.fn(function (event: string, handler: (value?: string) => void) {
            handlers[event] = handler
        }),
        changeLanguage: vi.fn(async function (language: string) {
            api.resolvedLanguage = language
            handlers.languageChanged?.(language)
        }),
        t: vi.fn(function (key: string) {
            return `translated:${key}`
        }),
    }
    api.use.mockImplementation(function () {
        return api
    })

    return { api, handlers }
})()

export const backendMock = (function () {
    return {
        loader: undefined as
            ((language: string) => Promise<unknown>) | undefined,
        backend: { type: 'backend' },
    }
})()

export const reactMock = (function () {
    return {
        subscribe: undefined as
            ((subscriber: () => void) => () => void) | undefined,
        getSnapshot: undefined as (() => string) | undefined,
        useSyncExternalStore: vi.fn(function (
            subscribe: (subscriber: () => void) => () => void,
            getSnapshot: () => string,
        ) {
            reactMock.subscribe = subscribe
            reactMock.getSnapshot = getSnapshot
            return getSnapshot()
        }),
    }
})()

vi.mock('i18next', function () {
    return {
        default: i18nextMock.api,
        changeLanguage: i18nextMock.api.changeLanguage,
        t: i18nextMock.api.t,
        use: i18nextMock.api.use,
    }
})

vi.mock('i18next-resources-to-backend', function () {
    return {
        default: vi.fn(function (
            loader: (language: string) => Promise<unknown>,
        ) {
            backendMock.loader = loader
            return backendMock.backend
        }),
    }
})

vi.mock('react', function () {
    return { useSyncExternalStore: reactMock.useSyncExternalStore }
})

export function resetLanguageTestHarness() {
    vi.clearAllMocks()
    i18nextMock.api.resolvedLanguage = undefined

    for (const event of Object.keys(i18nextMock.handlers)) {
        delete i18nextMock.handlers[event]
    }

    backendMock.loader = undefined
    reactMock.subscribe = undefined
    reactMock.getSnapshot = undefined
    restoreTestGlobals()
}

export function restoreLanguageTestHarness() {
    restoreTestGlobals()
}
