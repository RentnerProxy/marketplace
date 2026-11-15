import { beforeEach, expect, it, vi } from 'bun:test'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'

const state = { response: { ok: true } as unknown }
const runCore = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    options: {
        validateResult: (value: unknown) => unknown
        binaryInput: Uint8Array
    },
) {
    return options.validateResult(state.response)
})
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: runCore,
}))
vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
    getPublicStorageRoot: () => '/configured/public',
}))
const { publishSystemBrandingStorageService } =
    await import('@/server/Admin/SystemSettings/branding-storage.service.ts')

beforeEach(() => {
    runCore.mockClear()
    state.response = { ok: true }
})

it('publiziert die vollständige Variantenfolge mit einem validierten Core-Auftrag', async () => {
    await publishSystemBrandingStorageService(
        Buffer.from('large'),
        Buffer.from('small'),
        Buffer.from('ico'),
    )
    expect(runCore).toHaveBeenCalledTimes(1)
    expect(runCore.mock.calls[0]?.slice(0, 2)).toEqual([
        'storage',
        {
            operation: 'brandingPublish',
            rootDirectory: '/configured/public',
            binaryLengths: [5, 5, 3],
        },
    ])
    expect(runCore.mock.calls[0]?.[2].binaryInput).toEqual(
        Buffer.from('largesmallico'),
    )
})

it('kopiert die Varianten vor dem Core-Auftrag und verändert die Eingaben nicht', async () => {
    const inputs: [Buffer, Buffer, Buffer] = [
        Buffer.from('large'),
        Buffer.from('small'),
        Buffer.from('ico'),
    ]
    const originals = inputs.map((buffer) => Buffer.from(buffer))
    await publishSystemBrandingStorageService(...inputs)
    const payload = runCore.mock.calls[0]?.[2].binaryInput
    expect(
        inputs.every((input, index) => input.equals(originals[index]!)),
    ).toBe(true)
    for (const input of inputs) input.fill(0)
    expect(payload).toEqual(Buffer.from('largesmallico'))
})

it.each([0, IMAGE_UPLOAD_CONFIG.maxInputBytes + 1])(
    'verwirft eine ungültige Variante der Größe %i vor dem Core-Auftrag',
    async (size) => {
        await Promise.all(
            [0, 1, 2].map(async (index) => {
                const buffers: [Buffer, Buffer, Buffer] = [
                    Buffer.from('a'),
                    Buffer.from('b'),
                    Buffer.from('c'),
                ]
                buffers[index] = Buffer.alloc(size)
                await expect(
                    publishSystemBrandingStorageService(...buffers),
                ).rejects.toThrow()
            }),
        )
        expect(runCore).not.toHaveBeenCalled()
    },
)

it('verwirft eine unbestätigte native Veröffentlichung', async () => {
    state.response = { ok: false }
    await expect(
        publishSystemBrandingStorageService(
            Buffer.from('a'),
            Buffer.from('b'),
            Buffer.from('c'),
        ),
    ).rejects.toThrow()
})
