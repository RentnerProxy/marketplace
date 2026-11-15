import type { EnumerationProtectionDependencies } from './Types/enumeration-protection.types.ts'

export function createEnumerationProtection(
    minimumResponseMs: number,
    dependencies: EnumerationProtectionDependencies = {},
) {
    if (!Number.isSafeInteger(minimumResponseMs) || minimumResponseMs < 0) {
        throw new Error(
            'Die minimale Auth-Antwortzeit muss eine nicht negative ganze Zahl sein.',
        )
    }

    const now =
        dependencies.now ??
        function () {
            return performance.now()
        }
    const wait = dependencies.wait ?? Bun.sleep
    const startedAt = now()

    return {
        wait: async function () {
            const elapsedMs = Math.max(0, now() - startedAt)
            const remainingMs = Math.max(0, minimumResponseMs - elapsedMs)

            if (remainingMs > 0) {
                await wait(remainingMs)
            }
        },
    }
}
