import { vi } from 'bun:test'
import { stubTestGlobal } from '@/tests/shared/bunTestStubs.ts'

export function stubBrowserLanguage(
    storedLanguage: string | null,
    browserLanguage: string,
) {
    const localStorage = {
        getItem: vi.fn(() => storedLanguage),
        setItem: vi.fn(),
    }
    const documentElement = { lang: 'en' }
    stubTestGlobal('window', {
        localStorage,
        document: { documentElement },
        navigator: { language: browserLanguage },
    })

    return { documentElement, localStorage }
}
