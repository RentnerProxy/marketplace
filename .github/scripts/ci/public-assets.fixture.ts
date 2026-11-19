/* eslint-disable no-await-in-loop -- Verify bounded asset bytes and page responses without unbounded request fan-out. */
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const origin = 'http://127.0.0.1:3000'
const publicRoot = '/app/web/public'
const maxAssetBytes = 32 * 1024 * 1024
const maxPageBytes = 2 * 1024 * 1024

interface Identity {
    sha256: string
    sizeBytes: number
}

interface PublicAsset {
    name: string
    expected: Identity
    received: Identity
    status: number
    contentType: string
    headStatus: number
    headSize: number
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}

function request(name: string, init?: RequestInit) {
    return fetch(origin + name, {
        ...init,
        signal: AbortSignal.timeout(10_000),
    })
}

async function readBounded(
    stream: ReadableStream<Uint8Array> | null,
    maximum: number,
    consume?: (chunk: Uint8Array) => void,
) {
    if (!stream) return 0
    const reader = stream.getReader()
    let size = 0
    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) return size
            size += value.byteLength
            assert(
                size <= maximum,
                'Public asset or page exceeds its byte limit',
            )
            consume?.(value)
        }
    } finally {
        await reader.cancel().catch(() => undefined)
    }
}

async function measure(
    stream: ReadableStream<Uint8Array> | null,
): Promise<Identity> {
    const hash = new Bun.CryptoHasher('sha256')
    const sizeBytes = await readBounded(stream, maxAssetBytes, (chunk) => {
        hash.update(chunk)
    })
    return { sha256: hash.digest('hex'), sizeBytes }
}

async function inspectDirectory(assets: PublicAsset[], relative = '') {
    for (const entry of await readdir(path.join(publicRoot, relative), {
        withFileTypes: true,
    })) {
        const name = path.posix.join(relative, entry.name)
        if (entry.isDirectory()) {
            await inspectDirectory(assets, name)
            continue
        }
        assert(entry.isFile(), 'Unexpected public asset type: ' + name)
        assert(
            assets.length < 4096,
            'Packaged public asset count exceeds its limit',
        )
        const response = await request('/' + name)
        const received = await measure(response.body)
        const expected = await measure(
            Bun.file(path.join(publicRoot, name)).stream(),
        )
        const head = await request('/' + name, { method: 'HEAD' })
        assets.push({
            name,
            expected,
            received,
            status: response.status,
            contentType: response.headers.get('content-type') ?? '',
            headStatus: head.status,
            headSize: await readBounded(head.body, maxAssetBytes),
        })
    }
}

const assets: PublicAsset[] = []
await inspectDirectory(assets)
for (const route of ['/', '/apps', '/blog', '/imprint', '/privacy']) {
    const response = await request(route, {
        headers: { 'accept-language': 'de-DE,de;q=0.9', accept: 'text/html' },
    })
    let html = ''
    const decoder = new TextDecoder()
    await readBounded(response.body, maxPageBytes, (chunk) => {
        html += decoder.decode(chunk, { stream: true })
    })
    html += decoder.decode()
    assert(
        response.status === 200 && html.includes('<html lang="en"'),
        'Public route does not default to English: ' + route,
    )
    const compiledAssets = new Set(
        [...html.matchAll(/(?:href|src)="(\/assets\/[^"#]+)"/g)].map(
            (match) => match[1],
        ),
    )
    assert(
        compiledAssets.size > 0,
        'Public route has no compiled assets: ' + route,
    )
    assert(
        compiledAssets.size <= 512,
        'Compiled asset count exceeds its limit: ' + route,
    )
    for (const asset of compiledAssets) {
        const served = await request(asset)
        assert(
            served.status === 200 &&
                !(served.headers.get('content-type') ?? '').includes(
                    'text/html',
                ) &&
                (await readBounded(served.body, maxAssetBytes)) > 0,
            'Compiled page asset is not served: ' + asset,
        )
    }
}
console.log(JSON.stringify(assets))
