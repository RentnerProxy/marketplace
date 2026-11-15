import { afterEach, describe, expect, test, vi } from 'bun:test'
import { Writable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { writeLogLineService } from '@/server/Logging/log-transport.ts'

const sinks: Array<Writable> = []

function trackSink(sink: Writable) {
    sinks.push(sink)
    return sink
}

afterEach(function () {
    vi.restoreAllMocks()
    for (const sink of sinks.splice(0)) sink.destroy()
})

describe('Operational log transport', function () {
    test('writes unchanged lines and installs one persistent error handler per sink', function () {
        const received: Array<string> = []
        const sink = trackSink(
            new Writable({
                write(chunk: Buffer, _encoding, callback) {
                    received.push(chunk.toString('utf8'))
                    callback()
                },
            }),
        )
        for (let index = 0; index < 1_000; index++) {
            expect(
                writeLogLineService(sink, '{"event":"auth.rejected"}\n'),
            ).toBeUndefined()
        }
        expect(received).toHaveLength(1_000)
        expect(received[0]).toBe('{"event":"auth.rejected"}\n')
        expect(sink.listenerCount('error')).toBe(1)
        expect(sink.listenerCount('drain')).toBe(0)
    })

    test('drops backpressured lines without queueing them and accepts new lines after drain', async function () {
        const received: Array<string> = []
        const completions: Array<() => void> = []
        const sink = trackSink(
            new Writable({
                highWaterMark: 1,
                write(chunk: Buffer, _encoding, callback) {
                    received.push(chunk.toString('utf8'))
                    completions.push(callback)
                },
            }),
        )
        writeLogLineService(sink, 'first\n')
        expect(sink.writableNeedDrain).toBe(true)
        for (let index = 0; index < 1_000; index++) {
            writeLogLineService(sink, 'discarded\n')
        }
        expect(received).toEqual(['first\n'])
        expect(completions).toHaveLength(1)
        expect(sink.writableLength).toBe(Buffer.byteLength('first\n'))
        expect(sink.listenerCount('drain')).toBe(0)
        expect(sink.listenerCount('error')).toBe(1)

        completions.shift()?.()
        await setImmediate()
        expect(sink.writableNeedDrain).toBe(false)
        expect(sink.writableLength).toBe(0)
        expect(received).toEqual(['first\n'])

        writeLogLineService(sink, 'new\n')
        expect(received).toEqual(['first\n', 'new\n'])
        completions.shift()?.()
    })

    test.each(['destroyed', 'ended'] as const)(
        'does not write to a %s stream',
        function (state) {
            const write = vi.fn(function (_chunk, _encoding, callback) {
                callback()
            })
            const sink = trackSink(new Writable({ write }))
            if (state === 'destroyed') sink.destroy()
            else sink.end()
            expect(() => writeLogLineService(sink, 'discarded\n')).not.toThrow()
            expect(write).not.toHaveBeenCalled()
            expect(sink.writableLength).toBe(0)
        },
    )

    test.each([true, false])(
        'absorbs an actual asynchronous EPIPE with autoDestroy=%s and drops subsequent writes',
        async function (autoDestroy) {
            const write = vi.fn(function (_chunk, _encoding, callback) {
                queueMicrotask(function () {
                    callback(
                        Object.assign(new Error('synthetic pipe failure'), {
                            code: 'EPIPE',
                        }),
                    )
                })
            })
            const sink = trackSink(new Writable({ autoDestroy, write }))
            expect(() => writeLogLineService(sink, 'first\n')).not.toThrow()
            await setImmediate()
            expect(sink.errored).toMatchObject({ code: 'EPIPE' })
            expect(sink.destroyed).toBe(autoDestroy)
            for (let index = 0; index < 100; index++) {
                expect(() =>
                    writeLogLineService(sink, 'discarded\n'),
                ).not.toThrow()
            }
            expect(write).toHaveBeenCalledTimes(1)
            expect(sink.listenerCount('error')).toBe(1)
            expect(sink.listenerCount('drain')).toBe(0)
        },
    )

    test('installs the error handler before a write can emit an error', function () {
        const sink = trackSink(
            new Writable({
                write(_chunk, _encoding, callback) {
                    this.emit('error', new Error('synthetic synchronous event'))
                    callback()
                },
            }),
        )
        expect(() => writeLogLineService(sink, 'line\n')).not.toThrow()
        expect(sink.listenerCount('error')).toBe(1)
    })

    test('blocks a sink after a synchronous write exception instead of buffering later calls', function () {
        const write = vi.fn(function () {
            throw new Error('synthetic write failure')
        })
        const sink = trackSink(new Writable({ write }))
        expect(() => writeLogLineService(sink, 'first\n')).not.toThrow()
        const buffered = sink.writableLength
        for (let index = 0; index < 100; index++) {
            expect(() => writeLogLineService(sink, 'discarded\n')).not.toThrow()
        }
        expect(write).toHaveBeenCalledTimes(1)
        expect(sink.writableLength).toBe(buffered)
        expect(sink.listenerCount('error')).toBe(1)
    })

    test('does not write or retry attaching a handler after attachment throws', function () {
        const write = vi.fn()
        const sink = trackSink(new Writable({ write }))
        const attach = vi.spyOn(sink, 'on').mockImplementation(function () {
            throw new Error('synthetic listener failure')
        })
        for (let index = 0; index < 100; index++) {
            expect(() => writeLogLineService(sink, 'discarded\n')).not.toThrow()
        }
        expect(attach).toHaveBeenCalledTimes(1)
        expect(write).not.toHaveBeenCalled()
        expect(sink.listenerCount('error')).toBe(0)
    })

    test('never duplicates a handler when attachment throws after adding it', function () {
        const write = vi.fn()
        const sink = trackSink(new Writable({ write }))
        const originalOn = sink.on.bind(sink)
        const attach = vi.spyOn(sink, 'on').mockImplementation(function (
            ...args: Parameters<Writable['on']>
        ) {
            originalOn(...args)
            throw new Error('synthetic partial listener failure')
        })
        for (let index = 0; index < 100; index++) {
            expect(() => writeLogLineService(sink, 'discarded\n')).not.toThrow()
        }
        expect(attach).toHaveBeenCalledTimes(1)
        expect(write).not.toHaveBeenCalled()
        expect(sink.listenerCount('error')).toBe(1)
    })

    test('preserves existing stream error handlers', async function () {
        const error = new Error('synthetic observer failure')
        const observer = vi.fn()
        const sink = trackSink(
            new Writable({
                write(_chunk, _encoding, callback) {
                    queueMicrotask(function () {
                        callback(error)
                    })
                },
            }),
        )
        sink.on('error', observer)
        writeLogLineService(sink, 'line\n')
        await setImmediate()
        expect(observer).toHaveBeenCalledTimes(1)
        expect(observer).toHaveBeenCalledWith(error)
        expect(sink.listenerCount('error')).toBe(2)
    })

    test('isolates failed and healthy sinks without recursive logging', function () {
        const broken = trackSink(
            new Writable({
                write() {
                    throw new Error('synthetic write failure')
                },
            }),
        )
        const received: Array<string> = []
        const healthy = trackSink(
            new Writable({
                write(chunk: Buffer, _encoding, callback) {
                    received.push(chunk.toString('utf8'))
                    callback()
                },
            }),
        )
        writeLogLineService(broken, 'discarded\n')
        writeLogLineService(healthy, 'one\n')
        writeLogLineService(broken, 'discarded again\n')
        writeLogLineService(healthy, 'two\n')
        expect(received).toEqual(['one\n', 'two\n'])
        expect(broken.listenerCount('error')).toBe(1)
        expect(healthy.listenerCount('error')).toBe(1)
    })
})
