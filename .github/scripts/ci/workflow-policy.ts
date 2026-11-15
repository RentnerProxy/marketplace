import { Glob, YAML } from 'bun'
import { record } from '../automation/github.ts'

export function workflowPolicyErrors(file: string, source: string): string[] {
    const errors: string[] = []
    const workflow = record(YAML.parse(source))
    if (
        !workflow.permissions ||
        (!workflow.concurrency && !/[\\/]image\.yml$/.test(file))
    )
        errors.push(`${file}: missing default permissions or concurrency`)
    for (const action of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
        if (
            !action[1]?.startsWith('./') &&
            !/@[a-f0-9]{40}$/.test(action[1] ?? '')
        )
            errors.push(`${file}: action must use a full commit SHA`)
    }
    if (/persist-credentials:\s*true/.test(source))
        errors.push(`${file}: persisted checkout credentials`)
    for (const [name, value] of Object.entries(record(workflow.jobs))) {
        const job = record(value)
        if (!job.uses && !job['timeout-minutes'])
            errors.push(`${file}/${name}: missing timeout`)
    }
    if (
        'pull_request_target' in record(workflow.on) &&
        /github\.event\.pull_request\.head/.test(source)
    )
        errors.push(`${file}: privileged workflow must not execute PR source`)
    return errors
}

if (import.meta.main) {
    const errors: string[] = []
    for await (const file of new Glob('.github/workflows/*.{yml,yaml}').scan(
        '.',
    ))
        errors.push(...workflowPolicyErrors(file, await Bun.file(file).text()))
    if (errors.length) throw new Error(errors.join('\n'))
    console.log('Workflow security policy passed.')
}
