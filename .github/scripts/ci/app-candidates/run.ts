import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseCandidate, type AppManifest } from '@rentnerproxy/app-contracts'
import { target } from '@rentnerproxy/app-contracts/schemas'
import { runAppPipeline } from '../../native-tools.ts'
import { validateCandidatePackage } from './archive.ts'
import {
    readCandidateContext,
    requireDriverCheckout,
    writeWorkflowOutputs,
} from './context.ts'
import { sealCandidate, sealTarget } from './evidence.ts'
import { applianceImage, buildInSandbox } from './sandbox.ts'
import { smokeInSandbox } from './runtime-smoke.ts'
import { scanCandidate } from './scan.ts'
import { resolveSource, resolvedSource, stageSource } from './source.ts'

const directoryArgument = z.string().min(1)

function resolveDirectory(value: unknown) {
    return resolve(directoryArgument.parse(value))
}

async function resolveRequest(
    context: ReturnType<typeof readCandidateContext>,
) {
    const resolved = await resolveSource(context.request, process.env.GH_TOKEN)
    if (
        context.purpose === 'reference' &&
        resolved.source.repositoryId !== context.build.repositoryId
    ) {
        throw new Error(
            'Internal reference source repository ID does not match the workflow run',
        )
    }
    await writeWorkflowOutputs({
        source: JSON.stringify(resolved),
        artifact_key:
            context.artifactPrefix +
            '-' +
            context.build.runId +
            '-' +
            context.build.attempt,
    })
}

function sourceForRun(context: ReturnType<typeof readCandidateContext>) {
    const source = resolvedSource.parse(
        JSON.parse(z.string().parse(process.env.RESOLVED_SOURCE)) as unknown,
    )
    if (
        source.repository.toLowerCase() !==
            context.request.repository.toLowerCase() ||
        source.commit !== context.request.commit ||
        source.source.commit !== context.request.commit ||
        source.path !== context.request.path ||
        (context.purpose === 'reference' &&
            source.source.repositoryId !== context.build.repositoryId)
    ) {
        throw new Error('Resolved source was substituted between workflow jobs')
    }
    return source
}

async function buildTarget(
    context: ReturnType<typeof readCandidateContext>,
    requestedTarget: AppManifest['target'],
    outputDirectory: string,
) {
    const source = sourceForRun(context)
    const runnerTemp = await realpath(
        directoryArgument.parse(process.env.RUNNER_TEMP),
    )
    const directory = await mkdtemp(join(runnerTemp, 'app-candidate-'))
    const relativePath = (await realpath(directory)).slice(runnerTemp.length)
    if (!relativePath.startsWith(sep + 'app-candidate-')) {
        throw new Error(
            'Candidate build directory must be in runner temporary storage',
        )
    }
    try {
        const gitDirectory = join(directory, 'git')
        await mkdir(gitDirectory)
        console.log('Resolving the exact submitted source tree')
        const { sourceArchive, dependencies } = await stageSource(
            gitDirectory,
            source,
            process.env.GH_TOKEN,
        )
        const tarPath = join(directory, 'package.tar')
        console.log('Building the package in the isolated native environment')
        await buildInSandbox({
            sourceArchive,
            dependencyDirectory: dependencies,
            archivePath: tarPath,
            source: source.source,
            target: requestedTarget,
        })
        const packageDirectory = join(directory, 'package')
        console.log(
            'Checking archive boundaries, manifest, ELF and package files',
        )
        const { manifest, manifestSha256 } = await validateCandidatePackage(
            tarPath,
            packageDirectory,
            {
                source: source.source,
                target: requestedTarget,
            },
        )
        console.log(
            'Scanning locked dependencies and checking package contents',
        )
        const sbomPath = await scanCandidate({
            trivyBinary: join(runnerTemp, 'trivy'),
            directory,
            dependenciesDirectory: dependencies,
            packageDirectory,
            manifest,
        })
        console.log(
            'Starting the validated package and checking Unix-socket readiness offline',
        )
        await smokeInSandbox({ packageDirectory, manifest })
        const archivePath = join(directory, 'package.tar.zst')
        await runAppPipeline('compress-package', {
            inputPath: tarPath,
            outputPath: archivePath,
        })
        await sealTarget({
            outputDirectory,
            archivePath,
            sbomPath,
            manifest,
            manifestSha256,
            build: context.build,
            purpose: context.purpose,
            applianceImage,
        })
        console.log('Sealed the checked ' + requestedTarget + ' candidate')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

export function checkReferenceUpgrade(before: AppManifest, after: AppManifest) {
    const previous = before.data?.targetVersion
    const current = after.data?.targetVersion
    if (
        before.id !== after.id ||
        before.target !== after.target ||
        before.version !== '1.0.0' ||
        after.version !== '2.0.0' ||
        previous !== 1 ||
        current !== 2 ||
        !after.data?.readVersions.includes(previous) ||
        !after.data.migrations.some(
            (step) =>
                step.fromVersion === previous && step.toVersion === current,
        ) ||
        before.data?.writeVersions.includes(current) ||
        after.data.writeVersions.includes(previous)
    ) {
        throw new Error(
            'Reference fixtures must exercise a forward migration and reject an incompatible writer',
        )
    }
}

async function readReferenceCandidate(directory: string) {
    const path = join(directory, 'candidate.json')
    const info = await lstat(path)
    if (!info.isFile() || info.size < 1 || info.size > 1_048_576)
        throw new Error('Invalid reference candidate record')
    return parseCandidate((await Bun.file(path).json()) as unknown)
}

async function verifyReference(v1: string, v2: string) {
    const [before, after] = await Promise.all([
        readReferenceCandidate(v1),
        readReferenceCandidate(v2),
    ])
    if (
        before.source.repositoryId !== after.source.repositoryId ||
        before.source.commit !== after.source.commit ||
        before.id === after.id
    )
        throw new Error(
            'Reference fixtures lost their source or distinct identities',
        )
    for (const currentTarget of target.options) {
        const oldPackage = before.release.packages.find(
            (item) => item.manifest.target === currentTarget,
        )
        const newPackage = after.release.packages.find(
            (item) => item.manifest.target === currentTarget,
        )
        if (
            !oldPackage ||
            !newPackage ||
            oldPackage.archive.sha256 === newPackage.archive.sha256
        ) {
            throw new Error(
                'Both reference versions must have distinct native packages for every target',
            )
        }
        checkReferenceUpgrade(oldPackage.manifest, newPackage.manifest)
    }
    console.log(
        'Both reference app versions and their migration compatibility were verified',
    )
}

async function main() {
    const [command, first, second, third] = process.argv.slice(2)
    if (command === 'verify-reference') {
        await verifyReference(resolveDirectory(first), resolveDirectory(second))
        return
    }
    const context = readCandidateContext(process.env)
    await requireDriverCheckout(context.build.workflowCommit)
    switch (command) {
        case 'resolve':
            await resolveRequest(context)
            break
        case 'build':
            await buildTarget(
                context,
                target.parse(first),
                resolveDirectory(second),
            )
            break
        case 'seal': {
            const source = sourceForRun(context)
            const result = await sealCandidate({
                source: source.source,
                build: context.build,
                purpose: context.purpose,
                publisherName:
                    context.publisherName || source.repository.split('/')[0],
                targetDirectories: {
                    'linux-amd64': resolveDirectory(first),
                    'linux-arm64': resolveDirectory(second),
                },
                outputDirectory: resolveDirectory(third),
            })
            console.log(
                'Sealed both targets into a single ' +
                    context.purpose +
                    ' candidate',
            )
            await writeWorkflowOutputs({ candidate_id: result.id })
            break
        }
        default:
            throw new Error('Expected a candidate workflow command')
    }
}

if (import.meta.main) {
    try {
        await main()
    } catch (error) {
        // Public build logs contain stage names and bounded diagnostics, never
        // untrusted command output, manifest values or scanner findings.
        const message =
            error instanceof z.ZodError
                ? 'Candidate input, evidence or workflow metadata violates its schema'
                : error instanceof Error
                  ? error.message
                  : 'Candidate workflow failed'
        console.error(
            'Candidate pipeline: ' +
                message.replace(/\p{Cc}/gu, ' ').slice(0, 300),
        )
        process.exitCode = 1
    }
}
