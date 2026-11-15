import { describe, expect, test } from 'bun:test'
import {
    GitHubRequestError,
    record,
} from '../../../../../.github/scripts/automation/github.ts'
import type { GitHubRequest } from '../../../../../.github/scripts/automation/Types/pr-maintenance.types.ts'
import { releaseIdentity } from '../../../../../.github/scripts/release/release-identity.ts'
import { publishRelease, publishReleaseStatus } from '../../../../../.github/scripts/release/publish-release.ts'
import { renderReleaseStatus, releasePublication } from '../../../../../.github/scripts/release/release-presentation.ts'

const revision = 'b'.repeat(40)
const image = 'ghcr.io/rentnerproxy/marketplace@sha256:' + 'a'.repeat(64)
function changelog(tag = 'v1.2.3') {
    return {
        kind: 'published',
        id: 'release-1-2-3',
        category: 'changelog',
        releaseTag: tag,
        version: tag.slice(1),
        publishedAt: '2026-11-15',
        content: {
            en: {
                title: 'Marketplace account improvements',
                summary: 'A clearer central service.',
                body: [
                    'Improved account controls.',
                    'Fixed marketplace navigation.',
                ],
            },
        },
    }
}

describe('official release identity', () => {
    test('stable releases select latest', () => {
        expect(releaseIdentity('v1.2.3')).toEqual({
            tag: 'v1.2.3',
            prerelease: false,
            channel: 'latest',
        })
    })
    test.each([
        ['v0.1.0-alpha.1', 'alpha'],
        ['v1.0.0-beta.2', 'beta'],
        ['v2.0.0-rc.1', 'rc'],
    ])('prerelease %s selects its own %s channel', (tag, channel) => {
        expect(releaseIdentity(tag)).toEqual({
            tag,
            prerelease: true,
            channel,
        })
    })
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

describe('release build lifecycle', () => {
    const tag = 'v1.0.0-alpha.1'
    const run = 'https://github.com/RentnerProxy/marketplace/actions/runs/123'

    test('announces Alpha 1 as a regular Latest release without claiming its image is ready', async () => {
        const state = fixture()
        await publishReleaseStatus(state.request, tag, revision, changelog(tag), 'building', run)
        const created = record(state.calls.at(-1)?.body)
        expect(created).toMatchObject({ prerelease: false, make_latest: 'true', draft: false })
        expect(created.body).toContain('building-release-banner.png')
        expect(created.body).toContain('as soon as all checks and publication succeed')
        expect(created.body).toContain(run)
        expect(created.body).not.toContain(image)
        expect(releasePublication('v1.0.0-alpha.2')).toEqual({ prerelease: true, make_latest: 'false' })
    })

    test('replaces the placeholder with banner, authored changelog and exact image while preserving manual notes', async () => {
        const state = fixture({ id: 42, tag_name: tag, body: 'Manual note\n' + renderReleaseStatus(tag, revision, 'building', run) + '\nManual footer' })
        const body = await publishRelease(state.request, tag, image, changelog(tag), revision)
        expect(body.startsWith('Manual note\n')).toBe(true)
        expect(body.endsWith('\nManual footer')).toBe(true)
        expect(body).toContain('alpha-release-banner.png')
        expect(body).toContain('Improved account controls.')
        expect(body).toContain('Generated changes')
        expect(body).toContain('Marketplace-v1.0.0-alpha.1-CHANGELOG.md')
        expect(body).toContain(image)
        expect(body).not.toContain('New Version is Building')
    })

    test('reports failure honestly and replaces it on retry without duplicating markers', async () => {
        const state = fixture({ id: 42, tag_name: tag, body: renderReleaseStatus(tag, revision, 'building', run) })
        await publishReleaseStatus(state.request, tag, revision, changelog(tag), 'failed', run)
        const failed = record(state.calls.at(-1)?.body)
        expect(failed.body).toContain('Release build interrupted')
        expect(failed.body).toContain('not confirmed ready')
        const retry = fixture({ id: 42, tag_name: tag, body: failed.body })
        await publishReleaseStatus(retry.request, tag, revision, changelog(tag), 'building', run)
        expect(record(retry.calls.at(-1)?.body).body).toBe(renderReleaseStatus(tag, revision, 'building', run))
    })

    test('does not replace a completed release with a stale failure or build message', async () => {
        const state = fixture({ id: 42, tag_name: tag, body: '<!-- marketplace:appliance:start -->ready<!-- marketplace:appliance:end -->' })
        await publishReleaseStatus(state.request, tag, revision, changelog(tag), 'failed', run)
        expect(state.calls).toHaveLength(1)
    })

    test.each([[revision, 'https://example.com/run'], ['main', run]])('rejects untrusted media %s or workflow %s before writing', async (media, link) => {
            const state = fixture()
            await expect(publishReleaseStatus(state.request, tag, media ?? '', changelog(tag), 'building', link ?? '')).rejects.toThrow()
            expect(state.calls).toHaveLength(0)
    })
})

describe('native GitHub releases', () => {
    test('creates a stable release with generated notes and exact image digest', async () => {
        const state = fixture()
        await publishRelease(
            state.request,
            'v1.2.3',
            image,
            changelog('v1.2.3'),
            revision,
        )
        expect(state.calls.at(-1)).toMatchObject({
            method: 'POST',
            path: '/repos/rentnerproxy/marketplace/releases',
            body: {
                tag_name: 'v1.2.3',
                name: 'Marketplace account improvements',
                prerelease: false,
                make_latest: 'true',
            },
        })
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(image)
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(
            'A clearer central service.',
        )
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(
            'Improved account controls.',
        )
        expect(JSON.stringify(state.calls.at(-1)?.body)).toContain(
            'Fixed marketplace navigation.',
        )
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
        await publishRelease(
            state.request,
            'v1.2.3-beta.1',
            image,
            changelog('v1.2.3-beta.1'),
            revision,
        )
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
        await publishRelease(
            state.request,
            'v1.2.3',
            image,
            changelog('v1.2.3'),
            revision,
        )
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
        await publishRelease(
            state.request,
            'v1.2.3',
            image,
            changelog('v1.2.3'),
            revision,
        )
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
        await publishRelease(
            state.request,
            'v1.2.3',
            image,
            changelog('v1.2.3'),
            revision,
        )
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
            publishRelease(state.request, 'v1.2.3', image, changelog('v1.2.3'), revision),
        ).rejects.toThrow('ambiguous')
        expect(state.calls).toHaveLength(1)
    })
    test('fails closed for unavailable release lookup', async () => {
        const state = fixture(undefined, 403)
        await expect(
            publishRelease(state.request, 'v1.2.3', image, changelog('v1.2.3'), revision),
        ).rejects.toThrow()
        expect(state.calls).toHaveLength(1)
    })
    test('rejects inconsistent existing release identity', async () => {
        const state = fixture({ id: 42, tag_name: 'v9.9.9' })
        await expect(
            publishRelease(state.request, 'v1.2.3', image, changelog('v1.2.3'), revision),
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
                changelog('v1.2.3'),
            revision,
            ),
        ).rejects.toThrow()
        expect(state.calls).toHaveLength(0)
    })
})

test.each([
    ['v1.2.3', 'latest'],
    ['v1.2.3-alpha.1', 'alpha'],
    ['v1.2.3-beta.1', 'beta'],
    ['v1.2.3-rc.1', 'rc'],
])(
    'publisher channel CLI maps %s only to %s without Docker calls',
    async (tag, channel) => {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                '.github/scripts/release/release-identity.ts',
            ],
            {
                env: { ...process.env, RELEASE_TAG: tag },
                stdout: 'pipe',
                stderr: 'pipe',
                windowsHide: true,
            },
        )
        const [status, output, errors] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect(status).toBe(0)
        expect(errors).toBe('')
        expect(output.trim()).toBe(channel ?? '')
        if (tag?.includes('-alpha.')) {
            expect(output).not.toContain('beta')
            expect(output).not.toContain('latest')
        }
        if (tag?.includes('-rc.')) expect(output).not.toContain('latest')
    },
)
