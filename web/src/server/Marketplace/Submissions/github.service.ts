import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'

export class GitHubRequestError extends Error {
    readonly retryAt: Date | undefined

    constructor(
        readonly status: number,
        headers = new Headers(),
    ) {
        super('GitHub request failed')
        const retryAfter = headers.get('retry-after')
        const quotaExhausted = headers.get('x-ratelimit-remaining') === '0'
        if (
            status !== 429 &&
            !(status === 403 && (retryAfter || quotaExhausted))
        )
            return
        const now = Date.now()
        const reset = Number(headers.get('x-ratelimit-reset')) * 1000
        const retry =
            retryAfter && /^\d+$/.test(retryAfter)
                ? now + Number(retryAfter) * 1000
                : Date.parse(retryAfter ?? '')
        const deadline = Math.max(
            Number.isFinite(retry) ? retry : now + 60_000,
            quotaExhausted && Number.isFinite(reset) ? reset : 0,
        )
        this.retryAt = new Date(
            Math.min(now + 86_400_000, Math.max(now + 1_000, deadline)),
        )
    }
}

export const githubNumericId = z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .transform(String)

export function githubRequest(
    path: string,
    options: { token?: string; input?: object; redirect?: 'manual' } = {},
) {
    const headers = new Headers({
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'RentnerProxy-Marketplace',
    })
    if (options.token) headers.set('Authorization', 'Bearer ' + options.token)
    if (options.input) headers.set('Content-Type', 'application/json')
    return fetch('https://api.github.com' + path, {
        method: options.input ? 'POST' : 'GET',
        body: options.input ? JSON.stringify(options.input) : undefined,
        redirect: options.redirect ?? 'error',
        signal: AbortSignal.timeout(12_000),
        headers,
    })
}

export async function readBoundedBytes(response: Response, limit: number) {
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new GitHubRequestError(response.status, response.headers)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('GitHub returned an empty response')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        for (;;) {
            // The next chunk depends on the previous read.
            // oxlint-disable-next-line no-await-in-loop
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > limit)
                throw new Error('GitHub response exceeds its byte budget')
            chunks.push(value)
        }
    } finally {
        await reader.cancel()
    }
    return Buffer.concat(chunks, size)
}

export async function githubJson(
    path: string,
    options?: Parameters<typeof githubRequest>[1],
): Promise<unknown> {
    const response = await githubRequest(path, options)
    const bytes = await readBoundedBytes(response, 2 * 1024 * 1024)
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    return value
}

export function candidateApiPath(path: string) {
    return '/repos/' + pipeline.repository + '/actions/' + path
}
