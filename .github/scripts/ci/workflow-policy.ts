import { Glob, YAML } from 'bun'
import { runTooling, runToolingSync } from '../native-tools.ts'

function workflowInput(file: string, source: string) {
    return {
        file,
        source,
        workflow: YAML.parse(source),
    }
}

export function workflowPolicyErrors(file: string, source: string): string[] {
    return runToolingSync('policy-workflow', workflowInput(file, source))
}

async function workflowBatchErrors(
    workflows: ReturnType<typeof workflowInput>[],
): Promise<string[]> {
    if (workflows.length === 1)
        return runToolingSync('policy-workflow', workflows[0])

    try {
        return await runTooling('policy-workflows', workflows)
    } catch (error) {
        if (
            !(error instanceof Error) ||
            (error.message !== 'Native tool input exceeds its byte limit' &&
                error.message !== 'Native tool output exceeds its byte limit' &&
                error.message !== 'Invalid or ambiguous JSON')
        )
            throw error

        // Keep the same byte and nesting limits for individual workflows.
        const midpoint = Math.floor(workflows.length / 2)
        return (await workflowBatchErrors(workflows.slice(0, midpoint))).concat(
            await workflowBatchErrors(workflows.slice(midpoint)),
        )
    }
}

if (import.meta.main) {
    const workflows: ReturnType<typeof workflowInput>[] = []
    let errors: string[] = []
    try {
        for await (const file of new Glob(
            '.github/workflows/*.{yml,yaml}',
        ).scan('.')) {
            const source = await Bun.file(file).text()
            workflows.push(workflowInput(file, source))
        }
    } finally {
        // Validate any preceding inputs even if reading or parsing a later file failed.
        if (workflows.length) errors = await workflowBatchErrors(workflows)
    }
    if (errors.length) throw new Error(errors.join('\n'))
    console.log('Workflow security policy passed.')
}
