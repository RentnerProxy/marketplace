import { resolve } from 'node:path'
import { runNativeTool } from '@/lib/Core/native-tool.ts'
import { validateProjectIdentity } from './identity-validation.ts'

interface ProjectIdentityPlan {
    root: string
    changes: {
        file: string
        path: string
        before: string
        after: string
    }[]
}

export async function planProjectIdentitySync(
    rootDirectory: string,
    input: unknown,
) {
    const config = validateProjectIdentity(input)
    return runNativeTool<ProjectIdentityPlan>(
        'marketplace-tooling',
        'project-plan',
        { root: resolve(rootDirectory), config },
    )
}

export async function applyProjectIdentitySync(plan: ProjectIdentityPlan) {
    await runNativeTool('marketplace-tooling', 'project-apply', plan)
}
