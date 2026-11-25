import type {
    ByteRange,
    ProductionStorageAssetOptions,
} from './Types/production-assets.types.ts'
import { constants, type BigIntStats } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { matchesIfNoneMatch } from '@/lib/Request/etag.ts'
import { parsePublicStorageAssetPath } from '@/server/Request/storageAssetPath.service.ts'
import {
    RestoreInProgressError,
    StorageMutationBarrierUnavailableError,
    withSharedStorageMutationBarrier,
} from '@/server/Storage/storage-mutation-barrier.service.ts'
import type { ProductionAssetConfig } from './production.types.ts'

const versionedAssetCacheControl = 'public, max-age=31536000, immutable'
const runtimeAssetCacheControl =
    'public, max-age=3600, stale-while-revalidate=86400'
const defaultAssetCacheControl =
    'public, max-age=86400, stale-while-revalidate=604800'
const fallbackAssetCacheControl = 'public, max-age=300'
const MAX_PRODUCTION_STORAGE_ASSET_BYTES = IMAGE_UPLOAD_CONFIG.maxInputBytes

function getStorageAssetContentType(filePath: string) {
    if (filePath.endsWith('.webp')) {
        return 'image/webp'
    }

    if (filePath.endsWith('.ico')) {
        return 'image/x-icon'
    }

    return 'application/octet-stream'
}

export function isLegacyUserBackgroundPath(pathname: string) {
    return /^\/images\/user\/[^/]+\/background\.webp$/.test(pathname)
}

function isDefaultPublicImagePath(pathname: string) {
    return (
        pathname === '/images/default.webp' ||
        pathname === '/images/default-64.webp'
    )
}

function getStorageAssetFallbackPath(pathname: string) {
    if (pathname === '/favicon.ico') {
        return 'default.ico'
    }

    if (isDefaultPublicImagePath(pathname)) {
        return pathname.replace(/^\/+/, '')
    }

    if (
        pathname.startsWith('/images/system/') ||
        pathname.startsWith('/images/user/')
    ) {
        return pathname.endsWith('-64.webp')
            ? path.join('images', 'default-64.webp')
            : path.join('images', 'default.webp')
    }

    return null
}

function getAssetCacheControl(url: URL, isFallback: boolean) {
    if (isFallback) {
        return isDefaultPublicImagePath(url.pathname)
            ? defaultAssetCacheControl
            : fallbackAssetCacheControl
    }

    if (url.searchParams.has('v')) {
        return versionedAssetCacheControl
    }

    if (isDefaultPublicImagePath(url.pathname)) {
        return defaultAssetCacheControl
    }

    return runtimeAssetCacheControl
}

function assetAbsent(error: unknown) {
    return (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' ||
            error.code === 'ENOTDIR' ||
            error.code === 'ELOOP')
    )
}

function parseByteRange(rangeHeader: string, size: number): ByteRange | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())

    if (!match || size === 0 || (!match[1] && !match[2])) {
        return null
    }

    if (!match[1]) {
        const suffixLength = Number(match[2])

        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return null
        }

        return {
            start: Math.max(0, size - suffixLength),
            end: size - 1,
        }
    }

    const start = Number(match[1])
    const requestedEnd = match[2] ? Number(match[2]) : size - 1

    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(requestedEnd) ||
        start < 0 ||
        start >= size ||
        requestedEnd < start
    ) {
        return null
    }

    return { start, end: Math.min(requestedEnd, size - 1) }
}

function createAssetResponse(
    request: Request,
    absolutePath: string,
    cacheControl: string,
    file: BigIntStats,
    body: (start: number, end: number) => BodyInit,
) {
    if (!file.isFile()) return null
    if (
        file.size < 0n ||
        file.size > BigInt(MAX_PRODUCTION_STORAGE_ASSET_BYTES)
    ) {
        return new Response('Asset too large', {
            status: 413,
            headers: { 'cache-control': 'no-store' },
        })
    }
    const size = Number(file.size)
    const version = new Bun.CryptoHasher('sha256')
        .update(
            `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`,
        )
        .digest('hex')
    const etag = `W/"${version}"`
    const headers = new Headers({
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
        'content-type': getStorageAssetContentType(absolutePath),
        etag,
    })
    if (matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
        return new Response(null, { status: 304, headers })
    }
    const rangeHeader =
        request.method === 'GET' ? request.headers.get('range') : null
    const range = rangeHeader ? parseByteRange(rangeHeader, size) : null

    if (rangeHeader && !range) {
        headers.set('content-range', `bytes */${size}`)
        headers.set('content-length', '0')
        return new Response(null, { status: 416, headers })
    }

    if (range) {
        const contentLength = range.end - range.start + 1
        headers.set(
            'content-range',
            `bytes ${range.start}-${range.end}/${size}`,
        )
        headers.set('content-length', String(contentLength))
        return new Response(body(range.start, range.end + 1), {
            status: 206,
            headers,
        })
    }

    headers.set('content-length', String(size))
    return new Response(
        request.method === 'HEAD' || size === 0 ? null : body(0, size),
        {
            headers,
        },
    )
}

async function serveBundledFile(
    request: Request,
    absolutePath: string,
    cacheControl: string,
) {
    try {
        const metadata = await stat(absolutePath, { bigint: true })
        return createAssetResponse(
            request,
            absolutePath,
            cacheControl,
            metadata,
            (start, end) => Bun.file(absolutePath).slice(start, end),
        )
    } catch (error) {
        if (assetAbsent(error)) return null
        throw error
    }
}

async function openStorageFile(
    absolutePath: string,
    withStorageBarrier: typeof withSharedStorageMutationBarrier,
) {
    const opened: { file?: FileHandle } = {}
    try {
        return await withStorageBarrier(async function () {
            try {
                opened.file = await open(
                    absolutePath,
                    constants.O_RDONLY |
                        constants.O_NOFOLLOW |
                        constants.O_NONBLOCK,
                )
                return opened.file
            } catch (error) {
                if (assetAbsent(error)) return null
                throw error
            }
        })
    } catch (error) {
        await opened.file?.close()
        throw error
    }
}

async function serveOpenedFile(
    request: Request,
    absolutePath: string,
    cacheControl: string,
    file: FileHandle,
) {
    let reader: ReturnType<FileHandle['createReadStream']> | undefined
    try {
        const metadata = await file.stat({ bigint: true })
        return createAssetResponse(
            request,
            absolutePath,
            cacheControl,
            metadata,
            function (start, end) {
                reader = file.createReadStream({ start, end: end - 1 })
                const stream = Readable.toWeb(reader, {
                    strategy: { highWaterMark: 1 },
                })
                if (!(stream instanceof ReadableStream))
                    throw new Error('Invalid runtime asset stream.')
                return stream
            },
        )
    } catch (error) {
        reader?.destroy()
        throw error
    } finally {
        if (!reader) await file.close()
    }
}

export async function serveProductionStorageAssetService(
    request: Request,
    config: ProductionAssetConfig,
    options: ProductionStorageAssetOptions = {},
) {
    const url = new URL(request.url)

    if (!['GET', 'HEAD'].includes(request.method)) {
        return null
    }

    const parsedPath = parsePublicStorageAssetPath(url.pathname)

    if (parsedPath.kind === 'invalid') {
        return new Response('Not found', { status: 404 })
    }

    if (parsedPath.kind === 'not-storage') {
        return null
    }

    const { pathname: decodedPathname, relativePath } = parsedPath
    const absolutePath = path.resolve(config.publicStorageRoot, relativePath)
    const publicStorageRootWithSeparator = `${config.publicStorageRoot}${path.sep}`

    if (
        absolutePath !== config.publicStorageRoot &&
        !absolutePath.startsWith(publicStorageRootWithSeparator)
    ) {
        return new Response('Not found', { status: 404 })
    }

    const withStorageBarrier =
        options.withStorageBarrier ?? withSharedStorageMutationBarrier
    let storageAvailable = true
    let storageAssetResponse: Response | null = null

    try {
        // Keep admission through the open. Later renames cannot change the
        // representation streamed from the admitted file descriptor.
        const file = await openStorageFile(absolutePath, withStorageBarrier)
        if (file) {
            storageAssetResponse = await serveOpenedFile(
                request,
                absolutePath,
                getAssetCacheControl(url, false),
                file,
            )
        }
    } catch (error) {
        if (
            !(error instanceof RestoreInProgressError) &&
            !(error instanceof StorageMutationBarrierUnavailableError)
        ) {
            throw error
        }

        storageAvailable = false
    }

    if (storageAssetResponse) {
        return storageAssetResponse
    }

    const fallbackPath = getStorageAssetFallbackPath(decodedPathname)

    if (!fallbackPath) {
        return !storageAvailable
            ? new Response('Restore in progress', {
                  status: 503,
                  headers: {
                      'cache-control': 'no-store',
                      'retry-after': '3',
                  },
              })
            : null
    }

    return serveBundledFile(
        request,
        path.resolve(config.defaultPublicRoot, fallbackPath),
        getAssetCacheControl(url, true),
    )
}
