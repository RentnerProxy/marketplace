import type { RuntimeImageReferenceOptions } from './Types/runtime-image-reference.types.ts'

export async function createLocalRuntimeImageReferenceService(
    options: RuntimeImageReferenceOptions,
) {
    if (!/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(options.tag)) {
        throw new Error('Invalid isolated runtime image tag.')
    }
    const source = await options.docker([
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        options.source,
    ])
    const imageId = source.stdout.trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
        throw new Error('Invalid local runtime image identity.')
    }
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
            if (current.stdout.trim() !== imageId) {
                throw new Error(
                    'Refusing cleanup of a changed runtime image tag.',
                )
            }
            // Nur den eigenen Alias entfernen, niemals die übergebene Image-ID.
            await options.docker(['image', 'rm', options.tag])
        },
    }
}
