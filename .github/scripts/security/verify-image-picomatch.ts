import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { runTooling } from '../native-tools.ts'

const run = promisify(execFile)

export async function assertPatchedImagePackage(directory: string) {
    await runTooling('security-picomatch-image', { directory })
}

async function inspectDockerImage(
    image: string,
    directory: string,
    packagePath: string,
) {
    if (
        !(await runTooling<boolean>('security-docker-id', {
            value: image,
            kind: 'image',
        }))
    )
        throw new Error('Expected a Docker image ID.')
    // Read the files from a stopped container and bind the proof to its image ID.
    const { stdout } = await run('docker', ['create', '--pull=never', image])
    const container = stdout.trim()
    if (
        !(await runTooling<boolean>('security-docker-id', {
            value: container,
            kind: 'container',
        }))
    )
        throw new Error('Unexpected Docker container ID.')
    try {
        const installed = join(directory, 'package')
        await mkdir(join(installed, 'lib'), { recursive: true })
        const copy = (file: string) =>
            run('docker', [
                'cp',
                container + ':/' + packagePath + '/' + file,
                join(installed, file),
            ])
        await copy('package.json')
        await copy('lib/parse.js')
        await assertPatchedImagePackage(installed)
    } finally {
        await run('docker', ['rm', '-v', container])
    }
}

async function inspectOciImage(
    layout: string,
    directory: string,
    packagePath: string,
) {
    await runTooling('security-oci-scan-index', { directory: layout })
    const bundle = join(directory, 'bundle')
    // Apply OCI layers as data, including whiteouts, without starting the image.
    await run('umoci', [
        'unpack',
        '--rootless',
        '--image',
        layout + ':scan',
        bundle,
    ])
    await assertPatchedImagePackage(join(bundle, 'rootfs', packagePath))
}

if (import.meta.main) {
    const [image, mode] = Bun.argv.slice(2)
    try {
        if (!image) throw new Error('Scan image is required.')
        const packagePath = await runTooling<string>(
            'security-picomatch-path',
            {},
        )
        const directory = await mkdtemp(
            join(await realpath(tmpdir()), 'marketplace-image-patch-'),
        )
        try {
            if (mode === '--input')
                await inspectOciImage(image, directory, packagePath)
            else await inspectDockerImage(image, directory, packagePath)
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
