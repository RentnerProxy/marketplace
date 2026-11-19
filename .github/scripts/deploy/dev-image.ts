import { appendFile } from 'node:fs/promises'
import { runTooling } from '../native-tools.ts'

async function output(values: Record<string, string>) {
    await appendFile(
        process.env.GITHUB_OUTPUT ?? '',
        Object.entries(values)
            .map(([key, value]) => key + '=' + value + '\n')
            .join(''),
    )
}

async function main() {
    const [command, first, second] = process.argv.slice(2)
    if (command === 'scan-hash') {
        await runTooling('oci-hash-scan-archive', {
            path: first,
            expected: second,
        })
        return
    }
    if (command === 'scan-manifests') {
        await runTooling('oci-compare-scan-manifests', { first, second })
        return
    }
    if (command === 'registry-digest') {
        console.log(
            await runTooling<string>('oci-registry-digest', {
                path: first,
                expected: second,
            }),
        )
        return
    }
    if (command === 'registry-main') {
        await runTooling('oci-registry-main', {
            revision: process.env.GITHUB_SHA,
            currentMain: first,
        })
        return
    }
    const env = process.env
    const input = {
        command: command === 'candidate' ? 'seal' : command,
        context: {
            repository: env.GITHUB_REPOSITORY,
            eventName: env.GITHUB_EVENT_NAME,
            ref: env.GITHUB_REF,
            revision: env.GITHUB_SHA,
            workflowSha: env.GITHUB_WORKFLOW_SHA,
            workflowRef: env.GITHUB_WORKFLOW_REF,
            runId: env.GITHUB_RUN_ID,
            runAttempt: env.GITHUB_RUN_ATTEMPT,
        },
        temporary: env.RUNNER_TEMP,
        directory: env.CANDIDATE_DIRECTORY,
        imageId: env.IMAGE_ID,
        preflightArchiveSha256: env.PREFLIGHT_ARCHIVE_SHA256,
        testedArchiveSha256: env.TESTED_ARCHIVE_SHA256,
        expectedArchiveSha256: env.EXPECTED_ARCHIVE_SHA256,
        expectedEvidenceSha256: env.EXPECTED_EVIDENCE_SHA256,
        expectedDigest: env.EXPECTED_DIGEST,
        timestamp: new Date().toISOString(),
        remote: {
            immutable: env.REMOTE_IMMUTABLE_DIGEST,
            dev: env.REMOTE_DEV_DIGEST,
        },
    }
    switch (command) {
        case 'prepare':
        case 'loaded':
        case 'candidate':
            await output(
                await runTooling<Record<string, string>>('oci-dev', input),
            )
            break
        case 'preflight':
        case 'ready':
            console.log(await runTooling<string>('oci-dev', input))
            break
        case 'hashes':
        case 'verify':
        case 'assess':
        case 'published':
            await runTooling('oci-dev', input)
            break
        default:
            throw new Error('Unknown Dev image command')
    }
}

if (import.meta.main) await main()
