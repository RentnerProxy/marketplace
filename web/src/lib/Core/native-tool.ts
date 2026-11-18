import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Each Rust operation defines its own response type.
/* oxlint-disable typescript/no-unnecessary-type-parameters */

export type NativeTool = 'marketplace-app-pipeline' | 'marketplace-tooling'

const maxOutputBytes = 32 * 1024 * 1024
const timeout = 6 * 60_000
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const environmentKeys = [
    'PATH',
    'SystemRoot',
    'HOME',
    'USERPROFILE',
    'TMPDIR',
    'TMP',
    'TEMP',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'XDG_RUNTIME_DIR',
    'LLVM_PROFILE_FILE',
]

export function nativeToolPath(tool: NativeTool) {
    const setting =
        tool === 'marketplace-app-pipeline'
            ? process.env.MARKETPLACE_APP_PIPELINE_BIN
            : process.env.MARKETPLACE_TOOLING_BIN
    const executable = tool + (process.platform === 'win32' ? '.exe' : '')
    const paths = setting
        ? [resolve(setting)]
        : [
              resolve(workspace, 'core', 'target', 'release', executable),
              resolve(workspace, 'core', 'target', 'debug', executable),
              '/usr/local/bin/' + executable,
          ]
    const path = paths.find((candidate) => existsSync(candidate))
    if (!path)
        throw new Error(
            tool + ' is missing. Run bun --no-env-file run core:tools:build.',
        )
    return path
}

function environment() {
    return Object.fromEntries(
        environmentKeys.flatMap((key) => {
            const value = process.env[key]
            return value === undefined ? [] : [[key, value]]
        }),
    )
}

function decode<T>(
    status: number | null,
    stdout: Uint8Array,
    stderr: Uint8Array,
): T {
    const utf8 = new TextDecoder('utf-8', { fatal: true })
    if (status !== 0) {
        const message = utf8
            .decode(stderr)
            .replace(/\p{Cc}/gu, ' ')
            .trim()
        throw new Error(message.slice(0, 320) || 'Native tool failed')
    }
    const value: unknown = JSON.parse(utf8.decode(stdout))
    // Native commands own the response schemas used by their adapters.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as T
}

async function boundedBytes(
    stream: ReadableStream<Uint8Array>,
    maximum: number,
) {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
        for (;;) {
            // oxlint-disable-next-line no-await-in-loop -- read streams incrementally
            const { value, done } = await reader.read()
            if (done) return Buffer.concat(chunks, length)
            length += value.byteLength
            if (length > maximum)
                throw new Error('Native tool output exceeds its byte limit')
            chunks.push(value)
        }
    } finally {
        await reader.cancel().catch(() => undefined)
    }
}

async function runProcess<T>(
    tool: NativeTool,
    args: string[],
    stdin: Uint8Array | ReadableStream<Uint8Array>,
): Promise<T> {
    const child = Bun.spawn([nativeToolPath(tool), ...args], {
        stdin,
        stdout: 'pipe',
        stderr: 'pipe',
        signal: AbortSignal.timeout(timeout),
        env: environment(),
        windowsHide: true,
    })
    try {
        const [stdout, stderr, code] = await Promise.all([
            boundedBytes(child.stdout, maxOutputBytes),
            boundedBytes(child.stderr, 16 * 1024),
            child.exited,
        ])
        return decode<T>(code, stdout, stderr)
    } finally {
        if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL')
    }
}

export function runNativeTool<T>(
    tool: NativeTool,
    operation: string,
    input: unknown,
): Promise<T> {
    return runProcess<T>(tool, [operation], Buffer.from(JSON.stringify(input)))
}

export async function verifyNativeArtifactStream(
    body: ReadableStream<Uint8Array>,
    identity: { sha256: string; sizeBytes: number },
    destination?: string,
) {
    const args = ['stream-verify', String(identity.sizeBytes), identity.sha256]
    if (destination !== undefined) args.push(destination)
    try {
        return await runProcess<'verified' | 'mismatch' | 'length-exceeded'>(
            'marketplace-app-pipeline',
            args,
            body,
        )
    } finally {
        if (!body.locked) await body.cancel().catch(() => undefined)
    }
}

export function runNativeToolSync<T>(
    tool: NativeTool,
    operation: string,
    input: unknown,
): T {
    const result = Bun.spawnSync([nativeToolPath(tool), operation], {
        stdin: Buffer.from(JSON.stringify(input)),
        stdout: 'pipe',
        stderr: 'pipe',
        maxBuffer: maxOutputBytes,
        timeout,
        env: environment(),
        windowsHide: true,
    })
    return decode<T>(result.exitCode, result.stdout, result.stderr)
}
