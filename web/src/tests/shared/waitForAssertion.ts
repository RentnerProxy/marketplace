import type { WaitForAssertionOptions } from './waitForAssertion.test.types.ts'

export async function waitForAssertion(
    assertion: () => Promise<void> | void,
    options: WaitForAssertionOptions = {},
) {
    const intervalMs = options.intervalMs ?? 5
    const timeoutMs = options.timeoutMs ?? 1_000
    const deadline = performance.now() + timeoutMs
    let lastError: unknown

    async function attempt(): Promise<void> {
        try {
            await assertion()
            return
        } catch (error) {
            lastError = error
        }

        await Bun.sleep(intervalMs)

        if (performance.now() < deadline) {
            return attempt()
        }

        throw lastError
    }

    await attempt()
}
