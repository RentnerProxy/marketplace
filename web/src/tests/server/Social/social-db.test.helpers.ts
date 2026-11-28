type QueryCall = { method: string; args: Array<unknown> }

/**
 * Minimal stand-in for chained Drizzle queries: every awaited query resolves
 * with the next queued result, and each builder call is recorded.
 */
export function createQueuedDatabase() {
    const results: Array<unknown> = []
    const calls: Array<QueryCall> = []

    function createChain(): object {
        const chain: object = new Proxy(
            {},
            {
                get(_target, property) {
                    if (property === 'then') {
                        const value = results.shift()
                        return function (
                            resolve: (value: unknown) => unknown,
                            reject: (reason: unknown) => unknown,
                        ) {
                            return Promise.resolve(value).then(resolve, reject)
                        }
                    }

                    return function (...args: Array<unknown>) {
                        calls.push({ method: String(property), args })
                        return chain
                    }
                },
            },
        )

        return chain
    }

    const db = new Proxy(
        {},
        {
            get(_target, property) {
                return function (...args: Array<unknown>) {
                    calls.push({ method: String(property), args })
                    return createChain()
                }
            },
        },
    )

    return {
        db,
        calls,
        queue(...values: Array<unknown>) {
            results.push(...values)
        },
        reset() {
            results.length = 0
            calls.length = 0
        },
        methods() {
            return calls.map((call) => call.method)
        },
    }
}
