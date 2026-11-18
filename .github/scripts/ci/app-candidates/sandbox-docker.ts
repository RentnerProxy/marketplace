import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { AppManifest } from '../../../../contracts/v1/index.ts'

export const applianceImage =
    'ghcr.io/rentnerproxy/platform@sha256:6a9ecb2330c20f366590f4c6c1c32441104a44c8435d7858cbef4d9496e07b46'
export const bunVersion = '1.4.4'
export const appUser = '21001:21004'

const exec = promisify(execFile)
const logLimit = 1024 * 1024
const nativeArchitecture = { 'linux-amd64': 'amd64', 'linux-arm64': 'arm64' }

export function bindReadOnly(source: string, destination: string) {
    if (!isAbsolute(source) || /[,"\r\n]/u.test(source)) {
        throw new Error('Sandbox inputs require an absolute Docker mount path')
    }
    return ['--mount', `type=bind,src=${source},dst=${destination},readonly`]
}

export async function docker(args: string[], timeout = 20_000) {
    const { stdout } = await exec('docker', args, {
        timeout,
        maxBuffer: logLimit,
        windowsHide: true,
    })
    return stdout.trim()
}

function boundedOutput(maxBytes: number) {
    let bytes = 0
    return new Transform({
        transform(chunk: Buffer, _, done) {
            bytes += chunk.byteLength
            if (bytes > maxBytes) {
                done(new Error('Sandbox output exceeded its byte limit'))
                return
            }
            done(null, chunk)
        },
    })
}

function discard() {
    return new Writable({
        write(_chunk, _encoding, done) {
            done()
        },
    })
}

export async function attach(
    args: string[],
    options: {
        operation: string
        timeout: number
        input?: string
        archive?: { path: string; maxBytes: number }
    },
) {
    const signal = AbortSignal.timeout(options.timeout)
    const child = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        signal,
        windowsHide: true,
    })
    const exit = new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => {
            if (code === 0) resolve()
            else
                reject(
                    new Error(
                        `${options.operation} failed with exit status ${String(code)}`,
                    ),
                )
        })
    })

    const tasks = [
        exit,
        pipeline([options.input ?? ''], child.stdin, { signal }),
        pipeline(
            child.stdout,
            boundedOutput(options.archive?.maxBytes ?? logLimit),
            options.archive
                ? createWriteStream(options.archive.path, {
                      flags: 'wx',
                      mode: 0o600,
                  })
                : discard(),
            { signal },
        ),
        pipeline(child.stderr, boundedOutput(logLimit), discard(), { signal }),
    ]
    try {
        await Promise.all(tasks)
    } finally {
        if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL')
        await Promise.allSettled(tasks)
    }
}

export async function withSandbox<T>(
    options: {
        target: AppManifest['target']
        network?: string
        user?: string
        memoryMiB: number
        processLimit: number
        mounts: string[]
        command: string[]
    },
    run: (name: string) => Promise<T>,
) {
    const arch = nativeArchitecture[options.target]
    const native = await docker([
        'version',
        '--format',
        '{{.Server.Os}}/{{.Server.Arch}}',
    ])
    if (native !== `linux/${arch}`)
        throw new Error(`Expected native Linux Docker for ${options.target}`)

    const name = `marketplace-candidate-${randomUUID()}`
    try {
        await docker(
            [
                'create',
                '--name',
                name,
                '--pull=missing',
                '--platform',
                `linux/${arch}`,
                '--network',
                options.network ?? 'none',
                '--read-only',
                '--no-healthcheck',
                '--user',
                options.user ?? appUser,
                '--cap-drop',
                'ALL',
                '--security-opt',
                'no-new-privileges=true',
                '--init',
                '--log-driver',
                'none',
                '--workdir',
                '/',
                '--cpus',
                '2',
                '--pids-limit',
                String(options.processLimit),
                '--memory',
                `${options.memoryMiB}m`,
                '--memory-swap',
                `${options.memoryMiB}m`,
                '--ulimit',
                'nofile=256:256',
                '--ulimit',
                'core=0:0',
                '--shm-size',
                '16m',
                // Override the production image's declared data volume with empty, bounded RAM.
                '--tmpfs',
                '/var/lib/rentnerproxy:ro,nosuid,nodev,noexec,size=1m',
                ...options.mounts,
                '--entrypoint',
                '/usr/bin/env',
                applianceImage,
                '-i',
                'PATH=/usr/local/bin:/usr/bin:/bin',
                'HOME=/tmp',
                ...options.command,
            ],
            300_000,
        )
        return await run(name)
    } finally {
        await docker(['rm', '--force', '--volumes', name]).catch(
            (error: unknown) => {
                if (!/no such container/iu.test(String(error))) throw error
            },
        )
    }
}
