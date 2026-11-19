import { runNativeToolSync } from '@/lib/Core/native-tool.ts'

export function parseComposeConfigOutput(output: string): unknown {
    try {
        return runNativeToolSync(
            'marketplace-tooling',
            'verification-compose-config',
            { output },
        )
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'Invalid rendered Docker Compose JSON'
        ) {
            throw new SyntaxError(error.message)
        }
        throw error
    }
}
