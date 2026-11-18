import { runNativeTool } from '@/lib/Core/native-tool.ts'
import type { RuntimeImageReferenceOptions } from './Types/runtime-image-reference.types.ts'

export async function createLocalRuntimeImageReferenceService(
    options: RuntimeImageReferenceOptions,
) {
    await runNativeTool(
        'marketplace-tooling',
        'verification-runtime-image-tag',
        { tag: options.tag },
    )
    if (
        !(await runNativeTool<boolean>(
            'marketplace-tooling',
            'verification-runtime-image-ref',
            { reference: options.source },
        ))
    ) {
        throw new Error('Invalid isolated runtime image identity.')
    }
    const source = await options.docker([
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        options.source,
    ])
    const imageId = await runNativeTool<string>(
        'marketplace-tooling',
        'verification-runtime-image-id',
        {
            output: source.stdout,
        },
    )
    const existing = await options.docker(
        ['image', 'inspect', '--format', '{{.Id}}', options.tag],
        true,
    )
    if (existing.code === 0) {
        throw new Error('Refusing to replace an existing runtime image tag.')
    }
    // BuildKit interpretiert eine nackte sha256:-ID in FROM als Registry-Namen.
    await options.docker(['tag', imageId, options.tag])

    return {
        reference: options.tag,
        cleanup: async function () {
            const current = await options.docker(
                ['image', 'inspect', '--format', '{{.Id}}', options.tag],
                true,
            )
            if (current.code !== 0) return
            await runNativeTool(
                'marketplace-tooling',
                'verification-runtime-image-owner',
                {
                    expectedId: imageId,
                    output: current.stdout,
                },
            )
            // Nur den eigenen Alias entfernen, niemals die übergebene Image-ID.
            await options.docker(['image', 'rm', options.tag])
        },
    }
}
