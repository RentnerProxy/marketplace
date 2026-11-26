/* oxlint-disable no-await-in-loop -- Read and bound consecutive response chunks. */
import type { LoopbackJsonRequestOptions } from './Types/loopback-client.types.ts'

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost'])
const originPattern = /^https?:\/\/[a-z0-9.:[\]-]+\/?$/i

export function parseLoopbackOriginService(value: string): URL | null {
    if (!originPattern.test(value)) return null
    const url = URL.parse(value)
    return url && loopbackHosts.has(url.hostname) ? url : null
}

function isConnectionRefused(error: unknown) {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ConnectionRefused' || error.code === 'ECONNREFUSED')
    )
}

function fetchLoopback(url: URL, signal: AbortSignal) {
    const options = {
        signal,
        cache: 'no-store',
        redirect: 'error',
        proxy: false,
    } satisfies BunFetchRequestInit
    if (url.hostname !== 'localhost') return fetch(url, options)

    // Dial a numeric loopback address even if the host resolver is misconfigured.
    const localhostOptions = {
        ...options,
        headers: { host: url.host },
        ...(url.protocol === 'https:'
            ? { tls: { serverName: 'localhost' } }
            : {}),
    } satisfies BunFetchRequestInit
    url.hostname = '127.0.0.1'
    return fetch(url, localhostOptions).catch(function (error: unknown) {
        if (
            !isConnectionRefused(error) &&
            !(error instanceof Error && isConnectionRefused(error.cause))
        )
            throw error
        signal.throwIfAborted()
        const ipv6 = new URL(url)
        ipv6.hostname = '[::1]'
        return fetch(ipv6, localhostOptions)
    })
}

export async function fetchLoopbackJsonService(
    origin: string,
    pathname: string,
    search: URLSearchParams | undefined,
    { timeoutMs, maxResponseBytes, responseName }: LoopbackJsonRequestOptions,
): Promise<unknown> {
    const endpoint = parseLoopbackOriginService(origin)
    if (!endpoint) throw new Error('Invalid loopback HTTP origin.')
    endpoint.pathname = pathname
    if (search) endpoint.search = search.toString()

    const signal = AbortSignal.timeout(timeoutMs)
    const response = await fetchLoopback(endpoint, signal)
    const reader = response.body?.getReader()
    function cancel() {
        void reader?.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
        signal.throwIfAborted()
        if (!response.ok) throw new Error(`${responseName} unavailable.`)
        const declaredBytes = Number(response.headers.get('content-length'))
        if (declaredBytes > maxResponseBytes)
            throw new Error(`${responseName} response is too large.`)
        if (!reader) throw new Error(`${responseName} response is missing.`)

        const chunks: Uint8Array[] = []
        let observedBytes = 0
        while (true) {
            const result = await reader.read()
            signal.throwIfAborted()
            if (result.done) break
            if (result.value.byteLength === 0) continue
            observedBytes += result.value.byteLength
            if (observedBytes > maxResponseBytes)
                throw new Error(`${responseName} response is too large.`)
            chunks.push(result.value)
        }
        return JSON.parse(Buffer.concat(chunks, observedBytes).toString('utf8'))
    } finally {
        signal.removeEventListener('abort', cancel)
        cancel()
        reader?.releaseLock()
    }
}
