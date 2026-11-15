import { mkdir } from 'node:fs/promises'
import { z } from 'zod'

const command = process.argv[2]
const toolchain = z
    .object({
        toolchain: z.object({ channel: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    })
    .parse(Bun.TOML.parse(await Bun.file('core/rust-toolchain.toml').text()))
const channel = toolchain.toolchain.channel
const manifest = ['--manifest-path', 'core/Cargo.toml']
const commands: Record<string, string[]> = {
    build: ['build', ...manifest, '--locked', '--bins'],
    check: [
        'check',
        ...manifest,
        '--locked',
        '--all-targets',
        '--all-features',
    ],
    test: ['test', ...manifest, '--locked', '--all-targets', '--all-features'],
    lint: [
        'clippy',
        ...manifest,
        '--locked',
        '--all-targets',
        '--all-features',
        '--',
        '-D',
        'warnings',
    ],
    format: ['fmt', ...manifest, '--all'],
    'format:check': ['fmt', ...manifest, '--all', '--', '--check'],
    coverage: [
        'llvm-cov',
        ...manifest,
        '--locked',
        '--all-targets',
        '--all-features',
        '--fail-under-lines',
        '90',
        '--fail-under-functions',
        '90',
        '--lcov',
        '--output-path',
        '.tools/coverage/core/lcov.info',
    ],
    serve: [
        'run',
        ...manifest,
        '--locked',
        '--bin',
        'marketplace-appliance',
        '--',
        'serve',
    ],
}
const args = commands[command ?? '']
if (!args) throw new Error('Unbekannter Rust-Projektbefehl.')
if (command === 'coverage')
    await mkdir('.tools/coverage/core', { recursive: true })
const environment = { ...process.env }
const child = Bun.spawn(['cargo', `+${channel}`, ...args], {
    env: environment,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    windowsHide: true,
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => child.kill(signal))
}
process.exitCode = await child.exited
