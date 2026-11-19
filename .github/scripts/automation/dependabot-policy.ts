import { YAML } from 'bun'
import { runToolingSync } from '../native-tools.ts'
import type {
    DependabotEligibility,
    DependabotEligibilityInput,
} from './Types/dependabot-policy.types.ts'

export function evaluateDependabotEligibility(
    input: DependabotEligibilityInput,
) {
    const sources = runToolingSync<(string | null)[]>(
        'policy-dependabot-trailers',
        {
            commits: input.commits,
        },
    )
    const metadata = sources.map((source) => {
        if (source === null) return null
        try {
            return { source, document: YAML.parse(source) }
        } catch {
            return { source, invalid: true }
        }
    })
    return runToolingSync<DependabotEligibility>(
        'policy-dependabot-eligibility',
        {
            ...input,
            metadata,
        },
    )
}
