import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { record } from '../automation/github.ts'
import {
    createDevAssessment,
    createDevCandidate,
    createDevPublication,
    devImageIdentity,
    validateDevCandidate,
    verifyDevLoadedImage,
} from './dev-image-evidence.ts'

function required(key: string) {
    const value = process.env[key]
    if (!value) throw new Error(`Missing ${key}`)
    return value
}

function identity() {
    return devImageIdentity({
        repository: required('GITHUB_REPOSITORY'),
        eventName: required('GITHUB_EVENT_NAME'),
        ref: required('GITHUB_REF'),
        revision: required('GITHUB_SHA'),
        workflowSha: required('GITHUB_WORKFLOW_SHA'),
        workflowRef: required('GITHUB_WORKFLOW_REF'),
        runId: required('GITHUB_RUN_ID'),
        runAttempt: required('GITHUB_RUN_ATTEMPT'),
    })
}

function directory() {
    const temporary = required('RUNNER_TEMP')
    const path = required('CANDIDATE_DIRECTORY')
    if (
        !isAbsolute(temporary) ||
        !isAbsolute(path) ||
        resolve(path) !== join(resolve(temporary), 'marketplace-dev-candidate')
    )
        throw new Error(
            'Candidate directory must be the owned runner temporary directory',
        )
    return path
}

async function regularFile(path: string) {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Evidence must be a regular file')
    return info
}

async function hashFile(path: string) {
    await regularFile(path)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
}

async function jsonFile(name: string): Promise<unknown> {
    const path = join(directory(), name)
    if ((await regularFile(path)).size > 1024 * 1024)
        throw new Error('Evidence JSON exceeds its size limit')
    return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function save(name: string, value: unknown) {
    await writeFile(
        join(directory(), name),
        JSON.stringify(value, null, 2) + '\n',
        { mode: 0o600 },
    )
}

async function output(values: Record<string, string>) {
    await appendFile(
        required('GITHUB_OUTPUT'),
        Object.entries(values)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(''),
    )
}

async function verifyHashes() {
    await Promise.all(
        (
            [
                ['candidate-image.tar', 'EXPECTED_ARCHIVE_SHA256'],
                ['candidate.json', 'EXPECTED_EVIDENCE_SHA256'],
            ] as const
        ).map(async ([name, key]) => {
            const expected = required(key)
            if (
                !/^[a-f0-9]{64}$/.test(expected) ||
                expected.length !== 64 ||
                (await hashFile(join(directory(), name))) !== expected
            )
                throw new Error('Assessed candidate artifact hash mismatch')
        }),
    )
}

function sortedEntries(value: object) {
    return JSON.stringify(
        Object.entries(value).toSorted(([left], [right]) =>
            left.localeCompare(right),
        ),
    )
}

async function actualImage() {
    const manifest = await jsonFile('manifest.json')
    const configDigest = record(record(manifest).config).digest
    if (typeof configDigest !== 'string')
        throw new Error('Missing OCI config digest')
    return {
        archiveSha256: await hashFile(join(directory(), 'candidate-image.tar')),
        manifestDigest:
            'sha256:' + (await hashFile(join(directory(), 'manifest.json'))),
        imageId: process.env.IMAGE_ID ?? configDigest,
        manifest,
        config: await jsonFile('config.json'),
    }
}

async function verifiedCandidate() {
    await verifyHashes()
    const candidate = validateDevCandidate(
        await jsonFile('candidate.json'),
        identity(),
        await actualImage(),
    )
    if (candidate.digest !== required('EXPECTED_DIGEST'))
        throw new Error('Assessed candidate manifest digest mismatch')
    return candidate
}

async function readyCandidate() {
    const candidate = await verifiedCandidate()
    const assessment = await jsonFile('assessment.json')
    if (
        !assessment ||
        typeof assessment !== 'object' ||
        !('assessedAt' in assessment) ||
        typeof assessment.assessedAt !== 'string'
    )
        throw new Error('Missing successful publisher assessment')
    const expected = createDevAssessment(candidate, assessment.assessedAt)
    // Compare structured JSON independent of property order, rejecting extra or missing fields.
    if (sortedEntries(assessment) !== sortedEntries(expected))
        throw new Error('Publisher assessment does not match the candidate')
    return candidate
}

async function main() {
    const selected = identity()
    const command = process.argv[2]
    if (command === 'prepare') {
        await output({
            revision: selected.revision,
            image: selected.image,
            version: selected.version,
            immutable_tag: selected.immutableTag,
        })
    } else if (command === 'loaded') {
        const actual = await actualImage()
        // Structural validation only; successful checks are recorded after the tests.
        createDevCandidate(selected, actual)
        const inspected = await jsonFile('runtime-inspect.json')
        if (!Array.isArray(inspected) || inspected.length !== 1)
            throw new Error('Expected exactly one imported runtime image')
        const runtimeId = verifyDevLoadedImage(actual.config, inspected[0])
        await output({
            runtime_image_id: runtimeId,
            image_id: actual.imageId,
            archive_sha256: actual.archiveSha256,
        })
    } else if (command === 'candidate') {
        const actual = await actualImage()
        if (actual.archiveSha256 !== required('TESTED_ARCHIVE_SHA256'))
            throw new Error(
                'Candidate archive changed after runtime verification',
            )
        const candidate = createDevCandidate(selected, actual)
        await save('candidate.json', candidate)
        await output({
            digest: candidate.digest,
            archive_sha256: candidate.archiveSha256,
            evidence_sha256: await hashFile(
                join(directory(), 'candidate.json'),
            ),
        })
    } else if (command === 'hashes') {
        await verifyHashes()
    } else if (command === 'verify') {
        const candidate = await verifiedCandidate()
        await save('identity.json', {
            ...selected,
            digest: candidate.digest,
            imageConfigDigest: candidate.imageId,
        })
    } else if (command === 'assess') {
        await save(
            'assessment.json',
            createDevAssessment(
                await verifiedCandidate(),
                new Date().toISOString(),
            ),
        )
    } else if (command === 'ready') {
        await readyCandidate()
    } else if (command === 'published') {
        const candidate = await readyCandidate()
        await save(
            'publication.json',
            createDevPublication(
                candidate,
                {
                    immutable: required('REMOTE_IMMUTABLE_DIGEST'),
                    dev: required('REMOTE_DEV_DIGEST'),
                },
                new Date().toISOString(),
            ),
        )
    } else {
        throw new Error('Unknown Dev image command')
    }
}

if (import.meta.main) await main()
