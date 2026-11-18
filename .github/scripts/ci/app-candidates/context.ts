import { appendFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Candidate } from '../../../../contracts/v1/index.ts'
import { commit, githubId } from '../../../../contracts/v1/primitives.ts'
import type { Purpose } from './evidence.ts'
import { sourceRequest } from './source.ts'

const marketplace = 'rentnerproxy/marketplace'
const workflowPath = '.github/workflows/app-candidate.yml'
const reviewWorkflow = '.github/workflows/app-candidate-review.yml'
const referenceWorkflow = '.github/workflows/app-candidate-reference.yml'
const referencePath = '.github/scripts/ci/fixtures/app-candidate/'

const workflowInputs = z.strictObject({
    artifactPrefix: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    publisherName: z.string().regex(/^[^\p{Cc}\p{Cs}]{0,80}$/u),
})

export function classifyRun(context: {
    callerRepository: string
    callerWorkflow: string
    event: string
    callerRef: string
    callerSha: string
    workflowSha: string
    source: z.output<typeof sourceRequest>
}): Purpose {
    if (context.callerRepository.toLowerCase() === marketplace) {
        const caller = context.callerWorkflow.toLowerCase()
        if (caller.startsWith(marketplace + '/' + referenceWorkflow + '@')) {
            if (
                context.source.repository.toLowerCase() !== marketplace ||
                context.source.commit !== context.callerSha ||
                !['v1', 'v2'].some(
                    (version) =>
                        context.source.path === referencePath + version,
                )
            ) {
                throw new Error('Invalid internal reference candidate source')
            }
            return 'reference'
        }
        if (
            context.event === 'workflow_dispatch' &&
            context.callerRef === 'refs/heads/main' &&
            caller ===
                marketplace + '/' + reviewWorkflow + '@refs/heads/main' &&
            context.callerSha === context.workflowSha
        )
            return 'candidate'
    }
    return 'development'
}

export function readCandidateContext(env: NodeJS.ProcessEnv) {
    const request = sourceRequest.parse({
        repository: env.SOURCE_REPOSITORY,
        commit: env.SOURCE_COMMIT,
        path: env.SOURCE_PATH,
    })
    const { artifactPrefix, publisherName } = workflowInputs.parse({
        artifactPrefix: env.ARTIFACT_PREFIX,
        publisherName: env.PUBLISHER_NAME ?? '',
    })
    const workflowSha = commit.parse(env.DRIVER_SHA)
    if (
        env.DRIVER_REPOSITORY?.toLowerCase() !== marketplace ||
        env.DRIVER_PATH !== workflowPath
    ) {
        throw new Error(
            'The candidate builder must be loaded from the Marketplace workflow',
        )
    }
    const expectedAttempt = githubId.parse(env.GITHUB_RUN_ATTEMPT)
    const attempt = Number(expectedAttempt)
    if (!Number.isSafeInteger(attempt))
        throw new Error('Invalid GitHub run attempt')
    const build: Candidate['build'] = {
        repositoryId: githubId.parse(env.GITHUB_REPOSITORY_ID),
        workflowCommit: workflowSha,
        workflowPath,
        runId: githubId.parse(env.GITHUB_RUN_ID),
        attempt,
    }
    const purpose = classifyRun({
        callerRepository: z.string().parse(env.GITHUB_REPOSITORY),
        callerWorkflow: z.string().parse(env.GITHUB_WORKFLOW_REF),
        callerRef: z.string().parse(env.GITHUB_REF),
        callerSha: commit.parse(env.GITHUB_SHA),
        event: z.string().parse(env.GITHUB_EVENT_NAME),
        workflowSha,
        source: request,
    })
    return { request, build, purpose, publisherName, artifactPrefix }
}

export async function requireDriverCheckout(expectedSha: string) {
    const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        windowsHide: true,
    })
    const actual = (await new Response(child.stdout).text()).trim()
    if ((await child.exited) !== 0 || actual !== expectedSha) {
        throw new Error(
            'Candidate builder checkout differs from the effective workflow commit',
        )
    }
}

export async function writeWorkflowOutputs(fields: Record<string, string>) {
    const file = z.string().min(1).parse(process.env.GITHUB_OUTPUT)
    const output = Object.entries(fields)
        .map(([key, value]) => {
            if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(value))
                throw new Error('Invalid candidate workflow output')
            return key + '=' + value + '\n'
        })
        .join('')
    await appendFile(file, output)
}
