import { z } from 'zod'

export const catalogRepository = 'RentnerProxy/app-catalog'
export const catalogBranch = 'main'
export const repositoryPath = `/repos/${catalogRepository}`
export const oid = z.string().regex(/^[a-f0-9]{40}$/)

export async function readResponse(
    response: Response,
    maxBytes: number,
    consume: (chunk: Uint8Array) => void,
) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('GitHub response is missing its body')
    let size = 0
    try {
        for (;;) {
            // eslint-disable-next-line no-await-in-loop -- stream one chunk at a time
            const { done, value } = await reader.read()
            if (done) return size
            size += value.byteLength
            if (size > maxBytes)
                throw new Error('GitHub response exceeds the permitted length')
            consume(value)
        }
    } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
}

export async function responseBytes(response: Response, maxBytes: number) {
    const chunks: Uint8Array[] = []
    await readResponse(response, maxBytes, (chunk) => chunks.push(chunk))
    return Buffer.concat(chunks)
}

export function githubHttp(token: string, fetcher: typeof fetch) {
    if (!/^[A-Za-z0-9_.-]+$/.test(token))
        throw new Error('Invalid catalog GitHub App token')

    async function send(url: string, options: RequestInit, timeout: number) {
        const attempts = (options.method ?? 'GET') === 'GET' ? 3 : 1
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                // eslint-disable-next-line no-await-in-loop -- retry only bounded GET requests
                const response = await fetcher(url, {
                    ...options,
                    redirect: 'manual',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(timeout),
                })
                if (
                    attempt === attempts ||
                    ![502, 503, 504].includes(response.status)
                )
                    return response
                // eslint-disable-next-line no-await-in-loop -- release the response before retrying
                await response.body?.cancel()
            } catch {
                if (attempt === attempts)
                    throw new Error('GitHub catalog request failed')
            }
        }
        throw new Error('GitHub catalog request failed')
    }

    async function request(options: {
        path: string
        method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
        body?: unknown
        anonymous?: boolean
        allowMissing?: boolean
    }) {
        const { path, method = 'GET', body, anonymous, allowMissing } = options
        if (
            path !== '/graphql' &&
            path !== repositoryPath &&
            !path.startsWith(repositoryPath + '/')
        ) {
            throw new Error('Request outside the catalog GitHub repository')
        }
        const response = await send(
            `https://api.github.com${path}`,
            {
                method,
                credentials: 'omit',
                headers: {
                    accept: 'application/vnd.github+json',
                    'x-github-api-version': '2026-03-10',
                    ...(anonymous ? {} : { authorization: `Bearer ${token}` }),
                    ...(body === undefined
                        ? {}
                        : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
            25_000,
        )
        if (allowMissing && response.status === 404) {
            await response.body?.cancel()
            return null
        }
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(
                `GitHub catalog API returned HTTP ${response.status}`,
            )
        }
        if (response.status === 204 && method === 'DELETE') return null
        return JSON.parse(
            (await responseBytes(response, 2 * 1024 * 1024)).toString('utf8'),
        ) as unknown
    }

    async function upload(id: number, name: string, file: Blob) {
        const query = new URLSearchParams({ name })
        const response = await send(
            `https://uploads.github.com${repositoryPath}/releases/${id}/assets?${query}`,
            {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/octet-stream',
                    'content-length': file.size.toString(),
                    'x-github-api-version': '2026-03-10',
                },
                body: file,
            },
            120_000,
        )
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(
                `GitHub release asset upload returned HTTP ${response.status}`,
            )
        }
        return JSON.parse(
            (await responseBytes(response, 64 * 1024)).toString('utf8'),
        ) as unknown
    }

    return { request, upload, send }
}

export type GitHubHttp = ReturnType<typeof githubHttp>
