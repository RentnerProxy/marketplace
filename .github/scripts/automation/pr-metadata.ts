import {
    arrayPages,
    createGitHubRequest,
    record,
    repositoryName,
} from './github.ts'

export function validateTitle(title: unknown): boolean {
    return (
        typeof title === 'string' &&
        /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9./_-]*\))?!?: \S(?:[^\r\n]*\S)?$/.test(
            title,
        )
    )
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
    const rules = [
        ['area: web', /^(web\/src\/|package\.json$|bun\.lock$)/],
        ['area: core', /^core\//],
        ['area: automation', /^(\.github\/|\.coderabbit\.yaml$)/],
        ['area: appliance', /^(Dockerfile$|docker\/|docker-compose\.yml$)/],
    ] as const
    const labels = rules
        .filter(([, pattern]) =>
            files.some((file) => pattern.test(String(record(file).filename))),
        )
        .map(([label]) => label)
    if (labels.length)
        await request('POST', `/repos/${repository}/issues/${number}/labels`, {
            labels,
        })
}
