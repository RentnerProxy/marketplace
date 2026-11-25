import { afterEach, beforeEach, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serveProductionStorageAssetService } from '@/server/Production/assets.service.ts'
import { RestoreInProgressError } from '@/server/Storage/storage-mutation-barrier.service.ts'

let directory: string
let assetPath: string
let defaultRoot: string
const url = 'https://app.example.test/images/system/logo.webp'
const admit = async <T>(operation: () => T | Promise<T>) => operation()
const denyWhileRestoring = async () => {
    throw new RestoreInProgressError()
}

beforeEach(async function () {
    directory = await mkdtemp(path.join(tmpdir(), 'public-assets-test-'))
    assetPath = path.join(directory, 'images', 'system', 'logo.webp')
    defaultRoot = path.join(directory, 'bundled')
    await mkdir(path.dirname(assetPath), { recursive: true })
    await mkdir(path.join(defaultRoot, 'images'), { recursive: true })
    await Promise.all([
        writeFile(assetPath, 'first-image'),
        writeFile(path.join(defaultRoot, 'images', 'default.webp'), 'fallback'),
    ])
})

afterEach(async function () {
    await rm(directory, { recursive: true, force: true })
})

function serve(init: RequestInit = {}, withStorageBarrier = admit) {
    return serveProductionStorageAssetService(
        new Request(url, init),
        { publicStorageRoot: directory, defaultPublicRoot: defaultRoot },
        { withStorageBarrier },
    )
}

it('answers HEAD with matching GET metadata and handles a weak conditional range without a body', async function () {
    const response = await serve()
    expect(await response?.text()).toBe('first-image')
    const etag = response?.headers.get('etag')
    if (!etag) throw new Error('Missing runtime asset validator.')
    const head = await serve({ method: 'HEAD' })
    expect(head?.headers.get('content-length')).toBe('11')
    expect(head?.headers.get('etag')).toBe(etag)
    expect(head?.body).toBeNull()

    const unchanged = await serve({
        headers: {
            'if-none-match': '"unrelated,opaque", ' + etag.replace(/^W\//u, ''),
            range: 'bytes=0-3',
        },
    })
    expect(unchanged?.status).toBe(304)
    expect(unchanged?.headers.get('etag')).toBe(etag)
    expect(unchanged?.body).toBeNull()
})

it.skipIf(process.platform === 'win32')(
    'streams the admitted file after a concurrent atomic replacement',
    async function () {
        const replacement = path.join(directory, 'replacement.webp')
        await writeFile(replacement, 'new-image')
        const response = await serve({}, async function (operation) {
            const file = await operation()
            await rename(replacement, assetPath)
            return file
        })
        expect(await response?.text()).toBe('first-image')
        const next = await serve()
        expect(await next?.text()).toBe('new-image')
        expect(next?.headers.get('etag')).not.toBe(
            response?.headers.get('etag'),
        )
    },
)

it('serves the bundled validator and bytes when the restore gate rejects runtime access', async function () {
    const response = await serve({}, denyWhileRestoring)
    expect(await response?.text()).toBe('fallback')
    expect(response?.headers.get('cache-control')).toBe('public, max-age=300')
    const etag = response?.headers.get('etag')
    if (!etag) throw new Error('Missing bundled asset validator.')
    const head = await serve(
        { method: 'HEAD', headers: { 'if-none-match': etag } },
        denyWhileRestoring,
    )
    expect(head?.status).toBe(304)
    expect(head?.body).toBeNull()
})
