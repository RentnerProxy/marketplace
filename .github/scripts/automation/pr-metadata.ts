import { runTooling, runToolingSync } from '../native-tools.ts'
import {
    arrayPages,
    createGitHubRequest,
    record,
    repositoryName,
} from './github.ts'

export function validateTitle(title: unknown): boolean {
    return runToolingSync('policy-pr-title', { title })
}

if (import.meta.main) {
    const repository = repositoryName(process.env.GITHUB_REPOSITORY ?? '')
    const event = record(
        await Bun.file(process.env.GITHUB_EVENT_PATH ?? '').json(),
    )
    const pull = record(event.pull_request)
    if (!validateTitle(pull.title))
        throw new Error(
            'Use a Conventional Commit PR title, for example feat: add catalog validation',
        )
    const number = pull.number
    if (
        typeof number !== 'number' ||
        !Number.isSafeInteger(number) ||
        number <= 0
    )
        throw new Error('Invalid PR number')
    const request = createGitHubRequest(repository, process.env.GH_TOKEN ?? '')
    const files = await arrayPages(
        request,
        `/repos/${repository}/pulls/${number}/files`,
    )
    const labels = await runTooling<string[]>('policy-pr-labels', { files })
    if (labels.length)
        await request('POST', `/repos/${repository}/issues/${number}/labels`, {
            labels,
        })
}
