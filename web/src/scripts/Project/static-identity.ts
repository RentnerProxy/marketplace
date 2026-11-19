import { runNativeToolSync } from '@/lib/Core/native-tool.ts'
import type { ProjectIdentity } from '@/scripts/Types/project-identity.types.ts'
import { PROJECT_DOCUMENTATION_FILES } from './documentation-identity.ts'

export const MANAGED_PROJECT_FILES = [
    'package.json',
    'bun.lock',
    'web/public/manifest.json',
    'Dockerfile',
    'docker-compose.yml',
    '.env.dev.example',
    '.env.example',
    'web/src/scripts/provision-runtime-database-role.sql',
    ...PROJECT_DOCUMENTATION_FILES,
] as const

export function renderProjectIdentityFile(
    file: string,
    content: string,
    config: ProjectIdentity,
) {
    return runNativeToolSync<string>('marketplace-tooling', 'project-render', {
        file,
        content,
        config,
    })
}
