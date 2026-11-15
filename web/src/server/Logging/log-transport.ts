import type { Writable } from 'node:stream'

const guardedSinks = new WeakMap<Writable, boolean>()

function discardLogTransportError() {}

export function writeLogLineService(sink: Writable, line: string): void {
    try {
        if (!guardedSinks.has(sink)) {
            guardedSinks.set(sink, false)
            sink.on('error', discardLogTransportError)
            guardedSinks.set(sink, true)
        }
        if (
            !guardedSinks.get(sink) ||
            sink.destroyed ||
            sink.writableEnded ||
            sink.errored ||
            sink.writableNeedDrain ||
            !sink.writable
        ) {
            return
        }

        sink.write(line)
    } catch {
        guardedSinks.set(sink, false)
    }
}
