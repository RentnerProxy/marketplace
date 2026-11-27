import { deepStrictEqual, equal } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
    appendFileSync,
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractVersion } from '../../../contracts/v1/primitives.ts'
import { buildContractDocuments } from '../../../contracts/v1/schemas.ts'
import { runToolingSync } from '../native-tools.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const tsSource = 'contracts/v1'
const rustSource = 'core/app-contracts'
const npmName = '@rentnerproxy/app-contracts'
const crateName = 'rentnerproxy-app-contracts'
const version = contractVersion
const npmFile = `${crateName}-${version}.tgz`
const crateFile = `${crateName}-${version}.crate`
const bundleFiles = [
    'LICENSE',
    'contracts.schema.json',
    'openapi.json',
    npmFile,
    crateFile,
]

function command(bin: string, args: string[], cwd = root) {
    return execFileSync(bin, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
    }).trim()
}

function bun(args: string[], cwd = root) {
    return command(process.execPath, ['--no-env-file', ...args], cwd)
}

function writeJson(path: string, data: unknown) {
    writeFileSync(path, JSON.stringify(data, null, 4) + '\n')
}

function verifyCheckout(expectedCommit: string) {
    const commit = command('git', ['rev-parse', 'HEAD'])
    equal(
        commit,
        expectedCommit,
        'The checkout must match the requested commit',
    )
    const dirty = command('git', [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        tsSource,
        rustSource,
        '.github/scripts/ci/package-app-contracts.ts',
        '.github/scripts/native-tools.ts',
        'web/src/lib/Core/native-tool.ts',
        'core/Cargo.lock',
        'core/Cargo.toml',
        'core/rust-toolchain.toml',
        'core/artifacts',
        'core/tooling',
        'LICENSE',
        'bun.lock',
        'bunfig.toml',
        'package.json',
    ])
    equal(dirty, '', 'SDK artifact inputs must match the committed source')
}

function compileTypeScript(
    project: string,
    entry: string,
    options: Record<string, unknown>,
) {
    writeJson(project, {
        compilerOptions: {
            module: 'NodeNext',
            target: 'ES2023',
            strict: true,
            types: [],
            ...options,
        },
        files: [entry],
    })
    bun(['x', '--no-install', 'tsc', '--project', project])
}

function packageTypeScript(directory: string, bundle: string) {
    const packageDir = join(directory, 'npm')
    mkdirSync(packageDir)
    compileTypeScript(
        join(directory, 'tsconfig.json'),
        join(root, tsSource, 'index.ts'),
        {
            rootDir: join(root, tsSource),
            outDir: join(packageDir, 'dist'),
            declaration: true,
            rewriteRelativeImportExtensions: true,
        },
    )
    const zod: unknown = JSON.parse(
        readFileSync(join(root, 'node_modules/zod/package.json'), 'utf8'),
    )
    if (
        !zod ||
        typeof zod !== 'object' ||
        !('version' in zod) ||
        typeof zod.version !== 'string'
    )
        throw new Error('Cannot determine the installed Zod version')
    writeJson(join(packageDir, 'package.json'), {
        name: npmName,
        version,
        description: 'Versioned RentnerProxy app contract types and validators',
        license: 'MIT',
        private: true,
        type: 'module',
        engines: { node: '>=20' },
        exports: {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './contracts.schema.json': './contracts.schema.json',
            './openapi.json': './openapi.json',
        },
        files: ['dist', 'LICENSE', 'contracts.schema.json', 'openapi.json'],
        dependencies: { zod: zod.version },
    })
    for (const file of ['LICENSE', 'contracts.schema.json', 'openapi.json'])
        copyFileSync(join(bundle, file), join(packageDir, file))
    bun(['pm', 'pack', '--ignore-scripts', '--filename', npmFile], packageDir)
    copyFileSync(join(packageDir, npmFile), join(bundle, npmFile))
}

function packageRust(directory: string, bundle: string) {
    const packageDir = join(directory, 'rust')
    mkdirSync(packageDir)
    for (const file of command('git', [
        'ls-files',
        '-z',
        '--',
        rustSource + '/src/',
        rustSource + '/Cargo.toml',
        rustSource + '/build.rs',
    ])
        .split('\0')
        .filter(Boolean)) {
        const destination = join(packageDir, file.slice(rustSource.length + 1))
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(join(root, file), destination)
    }
    for (const file of ['LICENSE', 'contracts.schema.json'])
        copyFileSync(join(bundle, file), join(packageDir, file))
    copyFileSync(
        join(root, tsSource, 'upstream-probe-fixtures.json'),
        join(packageDir, 'upstream-probe-fixtures.json'),
    )
    copyFileSync(join(root, 'core/Cargo.lock'), join(packageDir, 'Cargo.lock'))
    // Reduce the locked workspace dependency graph to the standalone crate.
    command('cargo', ['tree', '--offline'], packageDir)
    const target = join(packageDir, 'target')
    command(
        'cargo',
        [
            'package',
            '--locked',
            '--offline',
            '--no-verify',
            '--target-dir',
            target,
        ],
        packageDir,
    )
    copyFileSync(join(target, 'package', crateFile), join(bundle, crateFile))
}

function buildBundle(directory: string, expectedCommit: string) {
    const bundle = join(directory, 'bundle')
    mkdirSync(bundle, { recursive: true })
    copyFileSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
    for (const [file, document] of Object.entries(buildContractDocuments())) {
        const rendered = JSON.stringify(document, null, 4) + '\n'
        equal(rendered, readFileSync(join(root, tsSource, file), 'utf8'), file)
        writeFileSync(join(bundle, file), rendered)
    }
    packageTypeScript(directory, bundle)
    packageRust(directory, bundle)
    writeJson(
        join(bundle, 'manifest.json'),
        runToolingSync<unknown>('contracts-bundle', {
            version,
            sourceCommit: expectedCommit,
            directory: bundle,
        }),
    )
    return bundle
}

function smokeTypeScript(directory: string, bundle: string) {
    mkdirSync(directory)
    copyFileSync(join(bundle, npmFile), join(directory, npmFile))
    writeJson(join(directory, 'package.json'), {
        name: 'app-contracts-consumer',
        private: true,
        type: 'module',
        dependencies: { [npmName]: 'file:./' + npmFile },
    })
    bun(['install', '--ignore-scripts'], directory)
    for (const file of ['LICENSE', 'contracts.schema.json', 'openapi.json'])
        deepStrictEqual(
            readFileSync(join(directory, 'node_modules', npmName, file)),
            readFileSync(join(bundle, file)),
            file,
        )
    copyFileSync(
        join(root, tsSource, 'fixtures.json'),
        join(directory, 'fixtures.json'),
    )
    const entry = join(directory, 'main.ts')
    writeFileSync(
        entry,
        `import { contractVersion, parseAppManifest, prepareHttpRequest, type AppManifest } from '${npmName}'
import fixtures from './fixtures.json' with { type: 'json' }
import schema from '${npmName}/contracts.schema.json' with { type: 'json' }
import openapi from '${npmName}/openapi.json' with { type: 'json' }
const { manifest } = fixtures
const app: AppManifest = parseAppManifest(manifest)
const readiness = prepareHttpRequest('getAppReadiness')
if (app.id !== manifest.id || contractVersion !== '${version}' ||
    openapi.info.version !== contractVersion ||
    schema.$id !== 'urn:rentnerproxy:app-contracts:' + contractVersion ||
    readiness.method !== 'GET' || readiness.socket !== 'app.sock' || readiness.path !== '/app/v1/ready')
    throw new Error('Installed SDK failed the manifest or readiness check')
`,
    )
    compileTypeScript(join(directory, 'tsconfig.json'), entry, {
        resolveJsonModule: true,
    })
    command('node', ['main.js'], directory)
}

function smokeRust(directory: string, bundle: string) {
    mkdirSync(join(directory, 'src'), { recursive: true })
    command('tar', ['-xf', join(bundle, crateFile), '-C', directory], directory)
    const crateDir = `${crateName}-${version}`
    for (const file of ['LICENSE', 'contracts.schema.json'])
        deepStrictEqual(
            readFileSync(join(directory, crateDir, file)),
            readFileSync(join(bundle, file)),
            file,
        )
    deepStrictEqual(
        readFileSync(join(directory, crateDir, 'upstream-probe-fixtures.json')),
        readFileSync(join(root, tsSource, 'upstream-probe-fixtures.json')),
        'upstream-probe-fixtures.json',
    )
    copyFileSync(
        join(root, tsSource, 'fixtures.json'),
        join(directory, 'fixtures.json'),
    )
    writeFileSync(
        join(directory, 'Cargo.toml'),
        `[package]
name = "app-contracts-consumer"
version = "0.0.0"
edition = "2024"

[dependencies]
${crateName} = { path = "${crateDir}", version = "=${version}" }
serde_json = "1.0"
`,
    )
    writeFileSync(
        join(directory, 'src/main.rs'),
        `use rentnerproxy_app_contracts::{
    Contracts, HttpMethod, HttpOperation, HttpRequestOptions, HttpSocket, ProtocolContracts,
};
use serde_json::{Value, json};

fn main() {
    let fixture: Value = serde_json::from_str(include_str!("../fixtures.json")).unwrap();
    let contracts = Contracts::new().unwrap();
    contracts.validate_manifest(&fixture["manifest"]).unwrap();
    assert!(contracts.validate_manifest(&json!({})).is_err());
    let readiness = ProtocolContracts::new().unwrap()
        .prepare_http_request(HttpOperation::GetAppReadiness, HttpRequestOptions::default())
        .unwrap();
    assert_eq!(readiness.method(), HttpMethod::Get);
    assert_eq!(readiness.socket(), HttpSocket::App);
    assert_eq!(readiness.path(), "/app/v1/ready");
}
`,
    )
    command(
        'cargo',
        ['run', '--offline', '--target-dir', join(directory, 'target')],
        directory,
    )
}

const [output, expectedCommit] = process.argv.slice(2)
if (!output || !expectedCommit)
    throw new Error('Expected the output directory and exact checkout commit')
verifyCheckout(expectedCommit)
// Fetch the workspace-locked dependency graph before staging crates offline.
command('cargo', ['tree', '--locked', '-p', crateName], join(root, 'core'))
const staging = mkdtempSync(join(tmpdir(), 'app-contract-sdk-'))
try {
    const first = buildBundle(join(staging, 'first'), expectedCommit)
    const second = buildBundle(join(staging, 'second'), expectedCommit)
    const files = [...bundleFiles, 'manifest.json']
    for (const file of files)
        deepStrictEqual(
            readFileSync(join(first, file)),
            readFileSync(join(second, file)),
            file + ' is not reproducible',
        )
    smokeTypeScript(join(staging, 'consumer-ts'), first)
    smokeRust(join(staging, 'consumer-rust'), first)
    verifyCheckout(expectedCommit)
    const destination = resolve(output)
    mkdirSync(destination)
    for (const file of files)
        copyFileSync(join(first, file), join(destination, file))
    const githubOutput = process.env.GITHUB_OUTPUT
    if (githubOutput) appendFileSync(githubOutput, `version=${version}\n`)
    console.log(
        `Verified app contract ${version} packages for ${expectedCommit}.`,
    )
} finally {
    rmSync(staging, { recursive: true, force: true })
}
