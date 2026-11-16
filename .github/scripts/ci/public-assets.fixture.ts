/* eslint-disable no-await-in-loop -- Verify bounded asset bytes and page responses without unbounded request fan-out. */
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const origin = 'http://127.0.0.1:3000'
const publicRoot = '/app/web/public'

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}

async function verifyDirectory(relative = ''): Promise<number> {
    let checked = 0
    for (const entry of await readdir(path.join(publicRoot, relative), {
        withFileTypes: true,
    })) {
        const name = path.posix.join(relative, entry.name)
        if (entry.isDirectory()) {
            checked += await verifyDirectory(name)
            continue
        }
        assert(entry.isFile(), 'Unexpected public asset type: ' + name)
        const response = await fetch(origin + '/' + name)
        const contentType = response.headers.get('content-type') ?? ''
        assert(
            response.status === 200 && !contentType.includes('text/html'),
            'Public asset returned a missing-file or HTML response: ' + name,
        )
        const expected = new Uint8Array(
            await Bun.file(path.join(publicRoot, name)).arrayBuffer(),
        )
        const actual = new Uint8Array(await response.arrayBuffer())
        assert(
            expected.byteLength > 0 &&
                Buffer.from(expected).equals(Buffer.from(actual)),
            'Public asset bytes differ from the packaged file: ' + name,
        )
        const types: Record<string, string> = {
            '.webp': 'image/webp',
            '.png': 'image/png',
            '.woff2': 'font/woff2',
            '.json': 'application/json',
        }
        const type = types[path.extname(name)]
        if (type)
            assert(
                contentType.startsWith(type),
                'Incorrect public asset content type: ' + name,
            )
        const head = await fetch(origin + '/' + name, { method: 'HEAD' })
        assert(
            head.status === 200 && (await head.arrayBuffer()).byteLength === 0,
            'Public asset HEAD failed: ' + name,
        )
        checked += 1
    }
    return checked
}

const checked = await verifyDirectory()
assert(checked >= 13, 'Expected the complete packaged public directory')
for (const route of ['/', '/apps', '/blog', '/imprint', '/privacy']) {
    const response = await fetch(origin + route, {
        headers: { 'accept-language': 'de-DE,de;q=0.9', accept: 'text/html' },
    })
    const html = await response.text()
    assert(
        response.status === 200 && html.includes('<html lang="en"'),
        'Public route does not default to English: ' + route,
    )
    const assets = new Set(
        [...html.matchAll(/(?:href|src)="(\/assets\/[^"#]+)"/g)].map(
            (match) => match[1],
        ),
    )
    assert(assets.size > 0, 'Public route has no compiled assets: ' + route)
    for (const asset of assets) {
        const served = await fetch(origin + asset)
        assert(
            served.status === 200 &&
                !(served.headers.get('content-type') ?? '').includes(
                    'text/html',
                ) &&
                (await served.arrayBuffer()).byteLength > 0,
            'Compiled page asset is not served: ' + asset,
        )
    }
}
console.log(
    `Verified ${checked} packaged public assets, image/font MIME types, GET/HEAD bytes and English public pages.`,
)
