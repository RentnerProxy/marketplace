import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { vi } from 'bun:test'

export type WorkerRequest = {
    requestId: number
    cancellationPath: string
    request: Record<string, unknown>
    binaryBytes?: number
}

export function createWorkerProcessFixture() {
    let closed = false
    let input = Buffer.alloc(0)
    let header: WorkerRequest | undefined
    let blocked = false
    let exitOnEof = true
    let release: (() => void) | undefined
    const requests: { header: WorkerRequest; bytes: Buffer }[] = []
    const written: Buffer[] = []
    const fixture = {
        requests,
        written,
        onRequest: (_header: WorkerRequest, _bytes: Buffer) => {},
        block() {
            blocked = true
        },
        release() {
            blocked = false
            release?.()
            release = undefined
        },
    }
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        ref: vi.fn(),
        unref: vi.fn(),
        stdout: Object.assign(new PassThrough(), {
            ref: vi.fn(),
            unref: vi.fn(),
        }),
        stderr: Object.assign(new PassThrough(), {
            ref: vi.fn(),
            unref: vi.fn(),
        }),
        stdin: new Writable({
            highWaterMark: 1,
            final(callback) {
                callback()
                if (exitOnEof) queueMicrotask(() => finish())
            },
            write(chunk: Buffer, _encoding, callback) {
                written.push(chunk)
                input = Buffer.concat([input, chunk])
                while (input.length) {
                    if (!header) {
                        const newline = input.indexOf(10)
                        if (newline === -1) break
                        header = JSON.parse(
                            input.subarray(0, newline).toString(),
                        ) as WorkerRequest
                        input = input.subarray(newline + 1)
                    }
                    const length = header.binaryBytes ?? 0
                    if (input.length < length) break
                    const bytes = Buffer.from(input.subarray(0, length))
                    input = input.subarray(length)
                    const received = header
                    header = undefined
                    requests.push({ header: received, bytes })
                    fixture.onRequest(received, bytes)
                }
                if (blocked) release = () => callback()
                else callback()
            },
        }),
        kill: vi.fn(() => {
            finish(137)
            return true
        }),
    })
    function finish(code = 0) {
        if (closed) return
        closed = true
        fixture.release()
        child.stdout.end()
        child.stderr.end()
        child.emit('exit', code)
        child.emit('close', code)
    }
    function send(value: unknown) {
        child.stdout.write(JSON.stringify(value) + '\n')
    }
    return {
        ...fixture,
        child,
        finish,
        send,
        stallOnEof() {
            exitOnEof = false
        },
        setHandler(handler: typeof fixture.onRequest) {
            fixture.onRequest = handler
        },
    }
}
