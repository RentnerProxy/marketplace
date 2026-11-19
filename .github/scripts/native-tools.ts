import {
    runNativeTool,
    runNativeToolSync,
} from '../../web/src/lib/Core/native-tool.ts'

// Each Rust operation defines its own response type.
/* oxlint-disable typescript/no-unnecessary-type-parameters */

export function runTooling<T>(operation: string, input: unknown): Promise<T> {
    return runNativeTool<T>('marketplace-tooling', operation, input)
}

export function runToolingSync<T>(operation: string, input: unknown): T {
    return runNativeToolSync<T>('marketplace-tooling', operation, input)
}

export function runAppPipeline<T>(
    operation: string,
    input: unknown,
): Promise<T> {
    return runNativeTool<T>('marketplace-app-pipeline', operation, input)
}

export function runAppPipelineSync<T>(operation: string, input: unknown): T {
    return runNativeToolSync<T>('marketplace-app-pipeline', operation, input)
}
