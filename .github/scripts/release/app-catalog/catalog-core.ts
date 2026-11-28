import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Catalog } from '@rentnerproxy/app-contracts'

export type SigningKeys = {
    targets: string
    snapshot: string
    timestamp: string
}
export type TrustedCatalog = { catalog: Catalog }

type CatalogRead = (
    path: string,
    maxBytes: number,
) => Promise<Uint8Array | null>
type CatalogOptions = { now?: Date; nextRoot?: Buffer }
type ReadOptions = CatalogOptions & { allowExpiredRoles?: boolean }
type UpdateOptions = CatalogOptions & { icons?: ReadonlyMap<string, Buffer> }

export interface CatalogCore {
    read(
        read: CatalogRead,
        pinnedRoot: Buffer,
        options?: ReadOptions,
    ): Promise<TrustedCatalog>
    update(
        state: TrustedCatalog,
        next: Catalog | undefined,
        options?: UpdateOptions,
    ): Promise<ReadonlyMap<string, Buffer>>
    bootstrap(root: Buffer, now?: Date): Promise<ReadonlyMap<string, Buffer>>
    close(): Promise<void>
}

const maxControlBytes = 4096
const maxRootBytes = 512 * 1024
const maxCatalogBytes = 16 * 1024 * 1024
const maxIconBytes = 2 * 1024 * 1024
const maxTotalIconBytes = 64 * 1024 * 1024
const maxIcons = 4096
const maxFiles = maxIcons + 5
const maxRequests = maxIcons + 1024 + 6
const ioTimeout = 90_000
const closeTimeout = 5_000

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const generationSchema = z.number().int().positive()
const pathSchema = z.strictObject({ path: z.string().max(192) })
const responseSchema = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('request'),
        path: pathSchema.shape.path,
        maxBytes: z.number().int().positive(),
    }),
    z.strictObject({
        type: z.literal('catalog'),
        generation: generationSchema,
    }),
    z.strictObject({
        type: z.literal('files'),
        count: z.number().int().min(0).max(maxFiles),
    }),
    z.strictObject({
        type: z.literal('error'),
        message: z.string().min(1).max(440),
    }),
])
const catalogEnvelope = z.strictObject({
    formatVersion: z.literal(1),
    revision: z.number().int().positive(),
    releases: z.custom<unknown[]>(Array.isArray),
    revocations: z.custom<unknown[]>(Array.isArray),
})

const metadataLimits = {
    root: maxRootBytes,
    snapshot: 128 * 1024,
    targets: 4 * 1024 * 1024,
    timestamp: 32 * 1024,
}
const maxTotalFileBytes =
    maxTotalIconBytes +
    maxCatalogBytes +
    Object.values(metadataLimits).reduce((total, limit) => total + limit, 0)
const logicalIconPath = /^assets\/[a-f0-9]{64}\.(?:png|webp)$/u
const staticIconPath =
    /^targets\/assets\/[a-f0-9]{64}\.[a-f0-9]{64}\.(?:png|webp)$/u

function staticFileLimit(path: string) {
    if (path !== path.trim()) return 0
    if (path === 'metadata/timestamp.json') return metadataLimits.timestamp
    const metadata =
        /^metadata\/([1-9][0-9]{0,15})\.(root|snapshot|targets)\.json$/u.exec(
            path,
        )
    if (metadata && Number.isSafeInteger(Number(metadata[1]))) {
        const role = metadata[2]
        if (role === 'root' || role === 'snapshot' || role === 'targets')
            return metadataLimits[role]
    }
    if (staticIconPath.test(path)) return maxIconBytes
    if (/^targets\/[a-f0-9]{64}\.catalog\.json$/u.test(path))
        return maxCatalogBytes
    return 0
}

function binaryPath() {
    const configured = process.env.APP_CATALOG_CORE_BIN
    const extension = process.platform === 'win32' ? '.exe' : ''
    const path = configured
        ? resolve(configured)
        : fileURLToPath(
              new URL(
                  `../../../../core/target/release/marketplace-app-catalog${extension}`,
                  import.meta.url,
              ),
          )
    if (!existsSync(path))
        throw new Error(
            'Catalog core binary is missing. Run bun --no-env-file run core:catalog:build or set APP_CATALOG_CORE_BIN to a built binary.',
        )
    return path
}

function catalogEnvironment(keys?: SigningKeys) {
    const profile = process.env.LLVM_PROFILE_FILE
    return {
        ...(profile && { LLVM_PROFILE_FILE: profile }),
        ...(keys && {
            APP_CATALOG_TARGETS_KEY: keys.targets,
            APP_CATALOG_SNAPSHOT_KEY: keys.snapshot,
            APP_CATALOG_TIMESTAMP_KEY: keys.timestamp,
        }),
    }
}

export async function extractCandidateZip(
    archive: string,
    destination: string,
    limits: Readonly<Record<string, number>>,
) {
    const child = Bun.spawn(
        [binaryPath(), 'extract-candidate', archive, destination],
        {
            stdin: Buffer.from(JSON.stringify(limits)),
            stdout: 'ignore',
            stderr: 'ignore',
            env: catalogEnvironment(),
            windowsHide: true,
            signal: AbortSignal.timeout(45_000),
        },
    )
    if ((await child.exited) !== 0)
        throw new Error('Invalid candidate ZIP contents')
}

class CatalogRejection extends Error {}
class TransportFailure extends Error {}

function invalidFrame() {
    return new TransportFailure('Invalid catalog core IPC frame')
}

class FrameReader {
    private readonly stream: ReadableStreamDefaultReader<Uint8Array>
    private pending: Uint8Array = new Uint8Array()

    constructor(stream: ReadableStream<Uint8Array>) {
        this.stream = stream.getReader()
    }

    private async take(length: number) {
        if (this.pending.length >= length) {
            const bytes = this.pending.subarray(0, length)
            this.pending = this.pending.subarray(length)
            return bytes
        }
        const bytes = Buffer.allocUnsafe(length)
        let written = 0
        while (written < length) {
            if (this.pending.length === 0) {
                // oxlint-disable-next-line no-await-in-loop -- one bounded stream chunk at a time
                const chunk = await this.stream.read()
                if (chunk.done)
                    throw new TransportFailure('Catalog core closed its output')
                this.pending = chunk.value
            }
            const size = Math.min(length - written, this.pending.length)
            bytes.set(this.pending.subarray(0, size), written)
            written += size
            this.pending = this.pending.subarray(size)
        }
        return bytes
    }

    async frame(limit: number) {
        const header = await this.take(4)
        const size = new DataView(
            header.buffer,
            header.byteOffset,
            4,
        ).getUint32(0)
        if (size === 0 || size > limit) throw invalidFrame()
        const bytes = await this.take(size)
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    }

    async cancel() {
        await this.stream.cancel().catch(() => undefined)
    }
}

function boundInput(bytes: Uint8Array, limit: number) {
    if (bytes.byteLength > limit)
        throw new Error('Catalog core input exceeds its byte limit')
    return bytes
}

function catalogFromBytes(bytes: Uint8Array): Catalog {
    const envelope = catalogEnvelope.parse(JSON.parse(decoder.decode(bytes)))
    // Rust authenticated these exact bytes and checked the full catalog contract.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return envelope as Catalog
}

export function openCatalogCore(keys?: SigningKeys): CatalogCore {
    const child = Bun.spawn([binaryPath()], {
        env: catalogEnvironment(keys),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
        windowsHide: true,
    })
    const reader = new FrameReader(child.stdout)
    let checkpoint: { state: TrustedCatalog; generation: number } | undefined
    let interrupted: ((error: Error) => void) | undefined
    let activity: (() => void) | undefined
    let unavailable = false
    let closing: Promise<void> | undefined
    function workerExited() {
        unavailable = true
        interrupted?.(new TransportFailure('Catalog core process exited'))
    }
    const exited = child.exited.then(workerExited, workerExited)

    function terminate() {
        unavailable = true
        if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL')
        void reader.cancel()
    }

    async function operation<T>(run: () => Promise<T>) {
        if (unavailable || closing) throw new Error('Catalog core is closed')
        if (interrupted)
            throw new Error('Catalog core already has an active operation')
        let timer: ReturnType<typeof setTimeout> | undefined
        const stopped = new Promise<never>((_resolve, reject) => {
            interrupted = reject
            activity = () => {
                clearTimeout(timer)
                timer = setTimeout(
                    () =>
                        reject(
                            new TransportFailure('Catalog core IPC timed out'),
                        ),
                    ioTimeout,
                )
            }
            activity()
        })
        try {
            return await Promise.race([run(), stopped])
        } catch (error) {
            if (error instanceof CatalogRejection) throw error
            terminate()
            if (error instanceof TransportFailure) throw error
            throw invalidFrame()
        } finally {
            clearTimeout(timer)
            activity = undefined
            interrupted = undefined
        }
    }

    async function sendFrame(bytes: Uint8Array) {
        if (unavailable || closing)
            throw new TransportFailure('Catalog core is closed')
        activity?.()
        const combined = bytes.byteLength <= maxControlBytes
        const header = Buffer.allocUnsafe(4 + (combined ? bytes.byteLength : 0))
        header.writeUInt32BE(bytes.byteLength)
        if (combined) header.set(bytes, 4)
        const pendingHeader = child.stdin.write(header)
        const pendingBytes = combined ? 0 : child.stdin.write(bytes)
        await Promise.all([pendingHeader, pendingBytes, child.stdin.flush()])
    }

    function sendControl(value: object) {
        return sendFrame(
            boundInput(Buffer.from(JSON.stringify(value)), maxControlBytes),
        )
    }

    function receiveFrame(limit: number) {
        activity?.()
        return reader.frame(limit)
    }

    async function receiveControl(): Promise<unknown> {
        return JSON.parse(decoder.decode(await receiveFrame(maxControlBytes)))
    }

    async function response() {
        const reply = responseSchema.parse(await receiveControl())
        if (reply.type === 'error')
            throw new CatalogRejection(
                reply.message.replace(/\p{Cc}/gu, ' ').slice(0, 220),
            )
        return reply
    }

    async function receiveFiles() {
        const reply = await response()
        if (reply.type !== 'files') throw invalidFrame()
        const files = new Map<string, Buffer>()
        let icons = 0
        let iconBytesLeft = maxTotalIconBytes
        let fileBytesLeft = maxTotalFileBytes
        for (let index = 0; index < reply.count; index++) {
            // oxlint-disable-next-line no-await-in-loop -- path precedes its raw frame
            const { path } = pathSchema.parse(await receiveControl())
            let bound = Math.min(staticFileLimit(path), fileBytesLeft)
            if (!bound || files.has(path)) throw invalidFrame()
            const isIcon = path.startsWith('targets/assets/')
            if (isIcon) {
                if (++icons > maxIcons) throw invalidFrame()
                bound = Math.min(bound, iconBytesLeft)
            }
            // oxlint-disable-next-line no-await-in-loop -- consume one bounded file at a time
            const bytes = await receiveFrame(bound)
            fileBytesLeft -= bytes.length
            if (isIcon) iconBytesLeft -= bytes.length
            files.set(path, bytes)
        }
        return files
    }

    async function closeWorker() {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            if (!unavailable && !interrupted)
                void Promise.resolve()
                    .then(() => child.stdin.end())
                    .catch(terminate)
            else {
                interrupted?.(new TransportFailure('Catalog core is closed'))
                terminate()
            }
            const stopped = await Promise.race([
                exited.then(() => true),
                new Promise<boolean>((done) => {
                    timer = setTimeout(() => done(false), closeTimeout)
                }),
            ])
            if (!stopped) {
                terminate()
                await exited
            }
        } finally {
            clearTimeout(timer)
            await reader.cancel()
        }
    }

    return {
        async read(read, pinnedRoot, options = {}) {
            const now = options.now?.toISOString()
            const allowExpiredRoles = options.allowExpiredRoles ?? false
            const root = boundInput(pinnedRoot, maxRootBytes)
            const nextRoot =
                options.nextRoot && boundInput(options.nextRoot, maxRootBytes)
            return operation(async () => {
                await sendControl({
                    type: 'read',
                    now,
                    allowExpiredRoles,
                    nextRoot: nextRoot !== undefined,
                })
                await sendFrame(root)
                if (nextRoot) await sendFrame(nextRoot)
                for (let requests = 0; requests <= maxRequests; requests++) {
                    // oxlint-disable-next-line no-await-in-loop -- the worker issues requests sequentially
                    const reply = await response()
                    if (reply.type === 'catalog') {
                        // oxlint-disable-next-line no-await-in-loop -- the catalog bytes follow the result
                        const bytes = await receiveFrame(maxCatalogBytes)
                        const state = { catalog: catalogFromBytes(bytes) }
                        checkpoint = { state, generation: reply.generation }
                        return state
                    }
                    if (
                        reply.type !== 'request' ||
                        requests === maxRequests ||
                        reply.maxBytes > staticFileLimit(reply.path)
                    )
                        throw invalidFrame()
                    let bytes: Uint8Array | null
                    try {
                        // oxlint-disable-next-line no-await-in-loop -- tied to the current worker request
                        bytes = await read(reply.path, reply.maxBytes)
                    } catch {
                        // oxlint-disable-next-line no-await-in-loop -- end this read while keeping the checkpoint
                        await sendControl({ type: 'fileError' })
                        continue
                    }
                    if (
                        bytes !== null &&
                        (!(bytes instanceof Uint8Array) ||
                            bytes.byteLength > reply.maxBytes)
                    )
                        throw new TransportFailure(
                            'Invalid catalog core static file reply',
                        )
                    // oxlint-disable-next-line no-await-in-loop -- send the corresponding file reply
                    await sendControl({ type: 'file', found: bytes !== null })
                    // oxlint-disable-next-line no-await-in-loop -- a found file has its own raw frame
                    if (bytes !== null) await sendFrame(bytes)
                }
                throw invalidFrame()
            })
        },
        async update(state, next, options = {}) {
            if (state !== checkpoint?.state)
                throw new Error('Stale or foreign trusted catalog state')
            const { generation } = checkpoint
            const now = options.now?.toISOString()
            const catalog =
                next === undefined
                    ? Buffer.alloc(0)
                    : boundInput(
                          Buffer.from(JSON.stringify(next)),
                          maxCatalogBytes,
                      )
            const nextRoot =
                options.nextRoot && boundInput(options.nextRoot, maxRootBytes)
            if (options.icons && options.icons.size > maxIcons)
                throw new Error('Too many catalog core icons')
            const icons = [...(options.icons ?? [])]
            let left = maxTotalIconBytes
            for (const [path, bytes] of icons) {
                if (path !== path.trim() || !logicalIconPath.test(path))
                    throw new Error('Invalid catalog core icon path')
                boundInput(bytes, Math.min(maxIconBytes, left))
                left -= bytes.length
            }
            return operation(async () => {
                await sendControl({
                    type: 'update',
                    generation,
                    now,
                    nextRoot: nextRoot !== undefined,
                    icons: icons.length,
                })
                await sendFrame(catalog)
                if (nextRoot) await sendFrame(nextRoot)
                for (const [path, bytes] of icons) {
                    // oxlint-disable-next-line no-await-in-loop -- path precedes its raw frame
                    await sendControl({ path })
                    // oxlint-disable-next-line no-await-in-loop -- each icon has its own raw frame
                    await sendFrame(bytes)
                }
                return receiveFiles()
            })
        },
        async bootstrap(root, now) {
            const time = now?.toISOString()
            boundInput(root, maxRootBytes)
            return operation(async () => {
                await sendControl({ type: 'bootstrap', now: time })
                await sendFrame(root)
                return receiveFiles()
            })
        },
        close() {
            closing ??= closeWorker()
            return closing
        },
    }
}
