import { describe, expect, test } from 'bun:test'
import {
    GitHubRequestError,
    record,
} from '../../../../../.github/scripts/automation/github.ts'
import type { GitHubRequest } from '../../../../../.github/scripts/automation/Types/pr-maintenance.types.ts'
import { releaseIdentity } from '../../../../../.github/scripts/release/release-identity.ts'
import { publishRelease } from '../../../../../.github/scripts/release/publish-release.ts'

const image = 'ghcr.io/rentnerproxy/marketplace@sha256:' + 'a'.repeat(64)

describe('official release identity', () => {
    test('stable releases select latest', () => {
        expect(releaseIdentity('v1.2.3')).toEqual({
            tag: 'v1.2.3',
            prerelease: false,
            channel: 'latest',
        })
    })
    test.each(['v0.1.0-alpha.1', 'v1.0.0-beta.2', 'v2.0.0-rc.1'])(
        'prerelease %s selects beta only',
        (tag) => {
            expect(releaseIdentity(tag)).toEqual({
                tag,
                prerelease: true,
                channel: 'beta',
            })
        },
    )
    test.each([
        '1.2.3',
        'v01.2.3',
        'v1.2',
        'v1.2.3-dev',
        'v1.2.3-beta.01',
        'v1.2.3\n',
        'v1.2.3;echo unsafe',
    ])('rejects invalid tag %s', (tag) => {
        expect(() => releaseIdentity(tag)).toThrow()
    })
})

function fixture(existing?: unknown, refusal?: number) {
    const calls: { method: string; path: string; body?: unknown }[] = []
    const request: GitHubRequest = (method, path, body) => {
        calls.push({ method, path, body })
        if (path.endsWith('/generate-notes'))
            return Promise.resolve({ body: 'Generated changes' })
        if (method === 'GET') {
            if (refusal) return Promise.reject(new GitHubRequestError(refusal))
            return existing === undefined
                ? Promise.reject(new GitHubRequestError(404))
                : Promise.resolve(existing)
        }
        return Promise.resolve({})
    }
    return { request, calls }
}

describe('native GitHub releases', () => {
    test('creates a stable release with generated notes and exact image digest', async () => {
        const state = fixture()
        await publishRelease(state.request, 'v1.2.3', image)
        expect(state.calls.at(-1)).toMatchObject({
            method: 'POST',
            path: '/repos/rentnerproxy/marketplace/releases',
            body: {
                tag_name: 'v1.2.3',
                prerelease: false,
                make_latest: 'true',
            },
        })
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(image)
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(
            'Generated changes',
        )
    })
    test('updates an existing prerelease without selecting latest', async () => {
        const state = fixture({
            id: 42,
            tag_name: 'v1.2.3-beta.1',
            body: 'Maintainer notes',
        })
        await publishRelease(state.request, 'v1.2.3-beta.1', image)
        expect(state.calls.at(-1)).toMatchObject({
            method: 'PATCH',
            path: '/repos/rentnerproxy/marketplace/releases/42',
            body: { body: expect.stringContaining('Channel: `beta`') },
        })
    })
    test('preserves custom title, manual migration/security notes and draft state across retries', async () => {
        const before =
            '## Migration\nRun the approved migration before upgrading.\n\n'
        const after =
            '\n\n## Security\nRotate the integration credential after rollout.\n'
        const originalImage =
            'ghcr.io/rentnerproxy/marketplace@sha256:' + 'b'.repeat(64)
        const existing = {
            id: 42,
            tag_name: 'v1.2.3',
            name: 'Marketplace release — staged migration',
            draft: true,
            prerelease: false,
            body:
                before +
                '<!-- marketplace:appliance:start -->\nOld digest: ' +
                originalImage +
                '\n<!-- marketplace:appliance:end -->' +
                after,
        }
        const state = fixture(existing)
        await publishRelease(state.request, 'v1.2.3', image)
        const update = record(state.calls.at(-1)?.body)
        if (typeof update.body !== 'string')
            throw new Error('Expected a release body update')
        expect(Object.keys(update)).toEqual(['body'])
        expect(update.body.startsWith(before)).toBe(true)
        expect(update.body.endsWith(after)).toBe(true)
        expect(update.body).toContain(image)
        expect(update.body).not.toContain(originalImage)
        expect(existing.name).toBe('Marketplace release — staged migration')
        expect(existing.draft).toBe(true)
        existing.body = update.body
        await publishRelease(state.request, 'v1.2.3', image)
        expect(state.calls.at(-1)?.body).toEqual(update)
        expect(
            state.calls.some((call) => call.path.endsWith('/generate-notes')),
        ).toBe(false)
    })
    test('appends an owned section while preserving an unmarked published release body', async () => {
        const state = fixture({
            id: 42,
            tag_name: 'v1.2.3',
            body: 'Handwritten release notes.\n',
            draft: false,
            name: 'Custom title',
        })
        await publishRelease(state.request, 'v1.2.3', image)
        expect(state.calls.at(-1)?.body).toEqual({
            body: expect.stringMatching(/^Handwritten release notes\.\n/),
        })
        expect(state.calls).toHaveLength(2)
    })
    test('rejects ambiguous machine markers without changing existing release content', async () => {
        const state = fixture({
            id: 42,
            tag_name: 'v1.2.3',
            body: '<!-- marketplace:appliance:start -->Manual content without an end marker',
        })
        await expect(
            publishRelease(state.request, 'v1.2.3', image),
        ).rejects.toThrow('ambiguous')
        expect(state.calls).toHaveLength(1)
    })
    test('fails closed for unavailable release lookup', async () => {
        const state = fixture(undefined, 403)
        await expect(
            publishRelease(state.request, 'v1.2.3', image),
        ).rejects.toThrow()
        expect(state.calls).toHaveLength(1)
    })
    test('rejects inconsistent existing release identity', async () => {
        const state = fixture({ id: 42, tag_name: 'v9.9.9' })
        await expect(
            publishRelease(state.request, 'v1.2.3', image),
        ).rejects.toThrow()
        expect(state.calls).toHaveLength(1)
    })
    test('rejects mutable or foreign images before API calls', async () => {
        const state = fixture()
        await expect(
            publishRelease(
                state.request,
                'v1.2.3',
                'ghcr.io/rentnerproxy/marketplace:latest',
            ),
        ).rejects.toThrow()
        expect(state.calls).toHaveLength(0)
    })
})
