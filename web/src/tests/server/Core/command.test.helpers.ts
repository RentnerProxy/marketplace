import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { vi } from 'bun:test'

export function createCoreProcessFixture() {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(function () {
            finish(137)
            return true
        }),
    })
    let closed = false
    function finish(code = 0) {
        if (closed) return
        closed = true
        child.stdout.end()
        child.stderr.end()
        child.emit('exit', code)
    }
    function send(message: unknown) {
        child.stdout.write(JSON.stringify(message) + '\n')
    }
    return { child, finish, send }
}
