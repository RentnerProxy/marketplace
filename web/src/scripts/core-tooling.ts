import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

const command = process.argv[2]
const toolchain = z
    .object({
        toolchain: z.object({ channel: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    })
    .parse(Bun.TOML.parse(await Bun.file('core/rust-toolchain.toml').text()))
const channel = toolchain.toolchain.channel
const manifest = ['--manifest-path', 'core/Cargo.toml']
const releaseBuild = ['build', ...manifest, '--locked', '--release']
const commands: Record<string, string[]> = {
    build: [
        'build',
        ...manifest,
        '--locked',
        '--bins',
        '--lib',
        '-p',
        'marketplace-core',
    ],
    'tools-build': [
        ...releaseBuild,
        '-p',
        'marketplace-app-pipeline',
        '-p',
        'marketplace-tooling',
    ],
    'tooling-build': [...releaseBuild, '-p', 'marketplace-tooling'],
    'catalog-build': [
        ...releaseBuild,
        '-p',
        'marketplace-app-catalog',
        '-p',
        'marketplace-app-pipeline',
    ],
    check: [
        'check',
        ...manifest,
        '--locked',
        '--workspace',
        '--all-targets',
        '--all-features',
    ],
    test: [
        'test',
        ...manifest,
        '--locked',
        '--workspace',
        '--all-targets',
        '--all-features',
    ],
    lint: [
        'clippy',
        ...manifest,
        '--locked',
        '--workspace',
        '--all-targets',
        '--all-features',
        '--',
        '-D',
        'warnings',
    ],
    format: ['fmt', ...manifest, '--all'],
    'format:check': ['fmt', ...manifest, '--all', '--', '--check'],
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
const cargo = ['cargo', `+${channel}`]

async function run(args: string[], env = process.env) {
    const child = Bun.spawn(args, {
        env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        windowsHide: true,
    })
    const terminate = () => child.kill('SIGTERM')
    const interrupt = () => child.kill('SIGINT')
    process.once('SIGTERM', terminate)
    process.once('SIGINT', interrupt)
    try {
        return await child.exited
    } finally {
        process.off('SIGTERM', terminate)
        process.off('SIGINT', interrupt)
    }
}

async function coverage() {
    const target = resolve('core/target/llvm-cov-target')
    const extension = process.platform === 'win32' ? '.exe' : ''
    const coverageEnv = { ...process.env, CARGO_LLVM_COV_TARGET_DIR: target }
    const testEnv = {
        ...coverageEnv,
        LLVM_PROFILE_FILE: join(target, 'marketplace-native-%p-%m.profraw'),
        APP_CATALOG_CORE_BIN: join(
            target,
            'debug',
            'marketplace-app-catalog' + extension,
        ),
        MARKETPLACE_APP_PIPELINE_BIN: join(
            target,
            'debug',
            'marketplace-app-pipeline' + extension,
        ),
        MARKETPLACE_TOOLING_BIN: join(
            target,
            'debug',
            'marketplace-tooling' + extension,
        ),
    }
    const cov = [...cargo, 'llvm-cov']
    await mkdir('.tools/coverage/core', { recursive: true })
    const phases = [
        {
            args: [...cov, 'clean', ...manifest, '--workspace'],
            env: coverageEnv,
        },
        {
            args: [
                ...cov,
                ...manifest,
                '--locked',
                '--workspace',
                '--all-targets',
                '--all-features',
                '--no-report',
            ],
            env: coverageEnv,
        },
        {
            args: [
                process.execPath,
                '--no-env-file',
                'test',
                '--isolate',
                '--path-ignore-patterns',
                '__no_ignored_tooling_tests__',
                'web/src/tests/tooling/GitHub',
                'web/src/tests/scripts',
                'web/src/tests/Deployment/project-identity',
                'test-database-url.test.ts',
            ],
            env: testEnv,
        },
        {
            args: [
                ...cov,
                'report',
                ...manifest,
                '--workspace',
                '--summary-only',
            ],
            env: coverageEnv,
        },
        {
            args: [
                ...cov,
                'report',
                ...manifest,
                '--workspace',
                '--fail-under-lines',
                '90',
                '--fail-under-functions',
                '90',
                '--lcov',
                '--output-path',
                '.tools/coverage/core/lcov.info',
            ],
            env: coverageEnv,
        },
    ]
    for (const phase of phases) {
        // oxlint-disable-next-line no-await-in-loop -- Each phase consumes the preceding profile output.
        const status = await run(phase.args, phase.env)
        if (status !== 0) return status
    }
    return 0
}

if (command === 'coverage') {
    process.exitCode = await coverage()
} else {
    const args = commands[command ?? '']
    if (!args) throw new Error('Unbekannter Rust-Projektbefehl.')
    process.exitCode = await run([...cargo, ...args])
    if (command === 'build' && process.exitCode === 0)
        process.exitCode = await run([
            ...cargo,
            'build',
            ...manifest,
            '--locked',
            '--profile',
            'ffi',
            '-p',
            'marketplace-storage-ffi',
        ])
}
