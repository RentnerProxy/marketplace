import { describe, expect, test } from 'bun:test'
import { createLocalRuntimeImageReferenceService } from '@/scripts/Deployment/runtime-image-reference.service.ts'

const imageId = 'sha256:' + 'a'.repeat(64)
const tag = 'appliance-synthetic-test:base'

function fixture(source = imageId) {
    const images = new Map([[source, imageId]])
    const commands: string[][] = []
    async function docker(arguments_: string[], allowFailure = false) {
        commands.push(arguments_)
        if (arguments_[0] === 'image' && arguments_[1] === 'inspect') {
            const id = images.get(arguments_.at(-1) ?? '')
            if (id) return { code: 0, stdout: id + '\n' }
            if (allowFailure) return { code: 1, stdout: '' }
            throw new Error('Local image not found.')
        }
        if (arguments_[0] === 'tag') {
            expect(arguments_[1]).toBe(imageId)
            images.set(arguments_[2], imageId)
            return { code: 0, stdout: '' }
        }
        if (arguments_[0] === 'image' && arguments_[1] === 'rm') {
            images.delete(arguments_[2])
            return { code: 0, stdout: '' }
        }
        throw new Error('Unexpected Docker command.')
    }
    return { images, commands, docker }
}

describe('local runtime image references for BuildKit', function () {
    test.each([imageId, 'appliance-existing:verified'])(
        'uses a disposable local tag for %s and preserves the source during cleanup',
        async function (source) {
            const state = fixture(source)
            const reference = await createLocalRuntimeImageReferenceService({
                source,
                tag,
                docker: state.docker,
            })
            expect(reference.reference).toBe(tag)
            expect(state.images.get(tag)).toBe(imageId)
            expect(state.commands).toContainEqual(['tag', imageId, tag])
            await reference.cleanup()
            await reference.cleanup()
            expect(state.images.has(tag)).toBe(false)
            expect(state.images.get(source)).toBe(imageId)
            expect(state.commands).not.toContainEqual(['image', 'rm', imageId])
        },
    )

    test('rejects a missing local source without pulling or building anything', async function () {
        const state = fixture()
        await expect(
            createLocalRuntimeImageReferenceService({
                source: 'missing:runtime',
                tag,
                docker: state.docker,
            }),
        ).rejects.toThrow('Local image not found')
        expect(state.commands).toHaveLength(1)
    })

    test('does not overwrite an existing tag', async function () {
        const state = fixture()
        state.images.set(tag, 'sha256:' + 'b'.repeat(64))
        await expect(
            createLocalRuntimeImageReferenceService({
                source: imageId,
                tag,
                docker: state.docker,
            }),
        ).rejects.toThrow('existing runtime image tag')
        expect(state.images.get(tag)).toBe('sha256:' + 'b'.repeat(64))
        expect(state.commands.some((command) => command[0] === 'tag')).toBe(
            false,
        )
    })

    test('does not delete a tag that was changed concurrently', async function () {
        const state = fixture()
        const reference = await createLocalRuntimeImageReferenceService({
            source: imageId,
            tag,
            docker: state.docker,
        })
        state.images.set(tag, 'sha256:' + 'b'.repeat(64))
        await expect(reference.cleanup()).rejects.toThrow(
            'changed runtime image tag',
        )
        expect(state.images.get(tag)).toBe('sha256:' + 'b'.repeat(64))
    })

    test('rejects malformed image identities and unsafe Dockerfile references', async function () {
        const state = fixture()
        state.images.set(imageId, 'invalid-image-identity')
        await expect(
            createLocalRuntimeImageReferenceService({
                source: imageId,
                tag,
                docker: state.docker,
            }),
        ).rejects.toThrow('Invalid local runtime image identity')
        await expect(
            createLocalRuntimeImageReferenceService({
                source: imageId,
                tag: 'sha256:bad\nRUN false',
                docker: state.docker,
            }),
        ).rejects.toThrow('Invalid isolated runtime image tag')
    })
})
