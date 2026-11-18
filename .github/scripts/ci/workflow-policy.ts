import { Glob, YAML } from 'bun'
import { runToolingSync } from '../native-tools.ts'

export function workflowPolicyErrors(file: string, source: string): string[] {
    return runToolingSync('policy-workflow', {
        file,
        source,
        workflow: YAML.parse(source),
    })
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
