import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from '../../../web/src/lib/Validation/isRecord.ts'
import {
    assertPicomatchSha256,
    patchedPicomatchVersion,
    picomatchParserSha256,
} from './picomatch-patch.ts'

const run = promisify(execFile)
const packagePath = `app/node_modules/.bun/picomatch@${patchedPicomatchVersion}/node_modules/picomatch`
const parserPath = 'lib/parse.js'

export async function assertPatchedImagePackage(directory: string) {
    const manifestPath = join(directory, 'package.json')
    const parser = join(directory, parserPath)
    await Promise.all(
        [manifestPath, parser].map(async (file) => {
            if (
                !(await lstat(file)).isFile() ||
                (await realpath(file)) !== file
            ) {
                throw new Error(
                    'Expected a regular picomatch file at its installed path.',
                )
            }
        }),
    )
    const manifest: unknown = await Bun.file(manifestPath).json()
    if (
        !isRecord(manifest) ||
        manifest.name !== 'picomatch' ||
        manifest.version !== patchedPicomatchVersion
    ) {
        throw new Error('Unexpected installed picomatch identity.')
    }
    await assertPicomatchSha256(parser, picomatchParserSha256)
}

async function inspectDockerImage(image: string, directory: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
        throw new Error('Expected a Docker image ID.')
    // Read the files from a stopped container and bind the proof to its image ID.
    const { stdout } = await run('docker', ['create', '--pull=never', image])
    const container = stdout.trim()
    if (!/^[a-f0-9]{64}$/.test(container))
        throw new Error('Unexpected Docker container ID.')
    try {
        const installed = join(directory, 'package')
        await mkdir(join(installed, 'lib'), { recursive: true })
        const copy = (file: string) =>
            run('docker', [
                'cp',
                `${container}:/${packagePath}/${file}`,
                join(installed, file),
            ])
        await copy('package.json')
        await copy(parserPath)
        await assertPatchedImagePackage(installed)
    } finally {
        await run('docker', ['rm', '-v', container])
    }
}

async function inspectOciImage(layout: string, directory: string) {
    const index: unknown = await Bun.file(join(layout, 'index.json')).json()
    const manifests = isRecord(index) ? index.manifests : undefined
    const manifest: unknown =
        Array.isArray(manifests) && manifests.length === 1
            ? manifests[0]
            : undefined
    if (
        !isRecord(manifest) ||
        manifest.mediaType !== 'application/vnd.oci.image.manifest.v1+json' ||
        !isRecord(manifest.annotations) ||
        manifest.annotations['org.opencontainers.image.ref.name'] !== 'scan'
    ) {
        throw new Error('Expected one OCI image manifest tagged scan.')
    }
    const bundle = join(directory, 'bundle')
    // Apply OCI layers as data, including whiteouts, without starting the image.
    await run('umoci', [
        'unpack',
        '--rootless',
        '--image',
        `${layout}:scan`,
        bundle,
    ])
    await assertPatchedImagePackage(join(bundle, 'rootfs', packagePath))
}

if (import.meta.main) {
    const [image, mode] = Bun.argv.slice(2)
    try {
        if (!image) throw new Error('Scan image is required.')
        const directory = await mkdtemp(
            join(await realpath(tmpdir()), 'marketplace-image-patch-'),
        )
        try {
            if (mode === '--input') await inspectOciImage(image, directory)
            else await inspectDockerImage(image, directory)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    } catch {
        console.log(
            'Image did not provide verifiable picomatch patch evidence.',
        )
        process.exitCode = 1
    }
}
