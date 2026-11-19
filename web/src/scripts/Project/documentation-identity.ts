import { runNativeToolSync } from '@/lib/Core/native-tool.ts'
import type { ProjectIdentity } from '@/scripts/Types/project-identity.types.ts'

export const PROJECT_DOCUMENTATION_FILES = ['README.md'] as const

export function renderProjectDocumentation(
    content: string,
    config: ProjectIdentity,
) {
    return runNativeToolSync<string>('marketplace-tooling', 'project-render', {
        file: 'README.md',
        content,
        config,
    })
}
