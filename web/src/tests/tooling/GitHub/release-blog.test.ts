import { describe, expect, test } from 'bun:test'
import {
    requireReleaseChangelog,
    renderReleaseBlogNotes,
    loadReleaseChangelog,
} from '../../../../../.github/scripts/release/release-blog.ts'
import { publishRelease } from '../../../../../.github/scripts/release/publish-release.ts'
import type { GitHubRequest } from '../../../../../.github/scripts/automation/Types/pr-maintenance.types.ts'

function fixture() {
    return {
        kind: 'published',
        id: 'marketplace-1-2-3',
        category: 'changelog',
        releaseTag: 'v1.2.3',
        version: '1.2.3',
        publishedAt: '2026-11-15',
        content: {
            en: {
                title: 'Account security improvements',
                summary: 'A safer shared marketplace service.',
                body: [
                    'Added a clearer account overview.',
                    'Fixed session controls.',
                ],
            },
        },
    }
}

describe('checked-in release changelog gate', () => {
    test('accepts the prepared first alpha as the exact release content without publishing it', async () => {
        const post = await loadReleaseChangelog('v1.0.0-alpha.1')
        expect(post.releaseTag).toBe('v1.0.0-alpha.1')
        expect(post.version).toBe('1.0.0-alpha.1')
        expect(post.id).toBe('marketplace-v1-0-0-alpha-1')
        expect(renderReleaseBlogNotes(post, '')).toContain(
            'Public registration remains closed',
        )
    })
    test('accepts exact-tag published English content and renders it with generated changes', () => {
        const post = requireReleaseChangelog([fixture()], 'v1.2.3')
        expect(post.content.en.title).toBe('Account security improvements')
        expect(renderReleaseBlogNotes(post, 'Generated compare link')).toBe(
            'A safer shared marketplace service.\n\nAdded a clearer account overview.\n\nFixed session controls.\n\n## GitHub-generated changes\n\nGenerated compare link',
        )
        expect(renderReleaseBlogNotes(post, '')).not.toContain(
            'GitHub-generated changes',
        )
    })
    test.each([
        ['missing', []],
        ['preview', [{ ...fixture(), kind: 'preview' }]],
        ['wrong tag', [{ ...fixture(), releaseTag: 'v1.2.4' }]],
        ['news only', [{ ...fixture(), category: 'news' }]],
        [
            'duplicate changelogs',
            [fixture(), { ...fixture(), id: 'another-release' }],
        ],
    ])('rejects %s content', (_reason, data) => {
        expect(() => requireReleaseChangelog(data, 'v1.2.3')).toThrow()
    })
    test('rejects version mismatch, malformed date and unsafe slug', () => {
        for (const post of [
            { ...fixture(), version: '1.2.4' },
            { ...fixture(), publishedAt: '2026-02-30' },
            { ...fixture(), id: '../release' },
        ])
            expect(() => requireReleaseChangelog([post], 'v1.2.3')).toThrow()
    })
    test('requires nonempty bounded English title, summary and paragraphs', () => {
        for (const english of [
            { ...fixture().content.en, title: '' },
            { ...fixture().content.en, title: 'x'.repeat(161) },
            { ...fixture().content.en, summary: 'x'.repeat(1201) },
            { ...fixture().content.en, body: [] },
            { ...fixture().content.en, body: [' '] },
            { ...fixture().content.en, body: ['x'.repeat(8001)] },
            {
                ...fixture().content.en,
                body: Array.from({ length: 65 }, () => 'Paragraph'),
            },
            {
                ...fixture().content.en,
                body: Array.from({ length: 7 }, () => 'x'.repeat(8000)),
            },
            {
                ...fixture().content.en,
                body: ['<!-- marketplace:appliance:start -->'],
            },
        ])
            expect(() =>
                requireReleaseChangelog(
                    [{ ...fixture(), content: { en: english } }],
                    'v1.2.3',
                ),
            ).toThrow()
        expect(() =>
            requireReleaseChangelog(
                [{ ...fixture(), content: { de: fixture().content.en } }],
                'v1.2.3',
            ),
        ).toThrow()
    })
    test('rejects content that would break the bundled article schema', () => {
        for (const post of [
            { ...fixture(), id: ' marketplace-1-2-3 ' },
            { ...fixture(), publishedAt: ' 2026-11-15' },
            { ...fixture(), unexpected: true },
            {
                ...fixture(),
                content: {
                    en: { ...fixture().content.en, subtitle: 'Unknown field' },
                },
            },
            {
                ...fixture(),
                content: {
                    en: fixture().content.en,
                    fr: { ...fixture().content.en, body: [] },
                },
            },
            {
                ...fixture(),
                content: {
                    en: fixture().content.en,
                    unsupported: fixture().content.en,
                },
            },
        ])
            expect(() => requireReleaseChangelog([post], 'v1.2.3')).toThrow()
    })
    test('rejects invalid tag before opening source data', async () => {
        await expect(loadReleaseChangelog('not-a-release')).rejects.toThrow(
            'official vSemVer',
        )
    })
    test('rejects missing changelog before any GitHub request', async () => {
        const requests: string[] = []
        const request: GitHubRequest = (_method, path) => {
            requests.push(path)
            return Promise.resolve({})
        }
        await expect(
            publishRelease(
                request,
                'v1.2.3',
                'ghcr.io/rentnerproxy/marketplace@sha256:' + 'a'.repeat(64),
                undefined,
                'b'.repeat(40),
            ),
        ).rejects.toThrow()
        expect(requests).toEqual([])
    })
})
