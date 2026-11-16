import { describe, expect, test } from 'bun:test'
import {
    GitHubRequestError,
    record,
} from '../../../../../.github/scripts/automation/github.ts'
import {
    originalAlpha1,
    resetOriginalAlpha1,
    validateResetContext,
} from '../../../../../.github/scripts/release/reset-alpha1.ts'
import type {
    Alpha1Context,
    Alpha1Request,
} from '../../../../../.github/scripts/release/Types/reset-alpha1.types.ts'

const repo = '/repos/RentnerProxy/marketplace'
const pkg = '/orgs/RentnerProxy/packages/container/marketplace'
const versionsPath = `${pkg}/versions?state=active&per_page=100&page=1`
const context: Alpha1Context = {
    repository: originalAlpha1.repository,
    event: 'workflow_dispatch',
    ref: 'refs/heads/main',
    workflowRef: `${originalAlpha1.repository}/.github/workflows/reset-alpha1.yml@refs/heads/main`,
    serverUrl: 'https://github.com',
    apiUrl: 'https://api.github.com',
}

function version(id: number, name: string, tags: string[]) {
    return { id, name, metadata: { container: { tags } } }
}

function fixture() {
    const responses = new Map<string, unknown>([
        [
            repo,
            { full_name: originalAlpha1.repository, default_branch: 'main' },
        ],
        [
            `${repo}/git/ref/tags/${originalAlpha1.tag}`,
            {
                ref: `refs/tags/${originalAlpha1.tag}`,
                object: { type: 'tag', sha: originalAlpha1.tagObject },
            },
        ],
        [
            `${repo}/git/tags/${originalAlpha1.tagObject}`,
            {
                sha: originalAlpha1.tagObject,
                tag: originalAlpha1.tag,
                object: { type: 'commit', sha: originalAlpha1.commit },
            },
        ],
        [
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            { id: originalAlpha1.releaseId, tag_name: originalAlpha1.tag },
        ],
        [
            pkg,
            {
                name: 'marketplace',
                package_type: 'container',
                repository: { full_name: originalAlpha1.repository },
            },
        ],
        [
            versionsPath,
            [
                version(11, originalAlpha1.digest, [
                    originalAlpha1.tag,
                    'alpha',
                ]),
                version(12, `sha256:${'4'.repeat(64)}`, ['dev', 'dev-2026']),
            ],
        ],
    ])
    const calls: [string, string][] = []
    const request: Alpha1Request = async (method, path) => {
        calls.push([method, path])
        if (method === 'DELETE') return undefined
        if (!responses.has(path)) throw new Error(`Unexpected GET ${path}`)
        const value = responses.get(path)
        if (value instanceof Error) throw value
        return value
    }
    return { responses, calls, request }
}

describe('one-time original Alpha1 reset', () => {
    test('validates all resources before deleting only the exact version and release', async () => {
        const state = fixture()
        expect(await resetOriginalAlpha1(state.request, context)).toEqual({
            packageDeleted: true,
            releaseDeleted: true,
        })
        expect(state.calls.slice(-2)).toEqual([
            ['DELETE', `${pkg}/versions/11`],
            ['DELETE', `${repo}/releases/${originalAlpha1.releaseId}`],
        ])
        expect(state.calls.filter(([method]) => method === 'GET')).toHaveLength(
            6,
        )
        expect(
            state.calls.some(
                ([method, path]) => method === 'DELETE' && path.includes('/12'),
            ),
        ).toBe(false)
    })

    test.each([
        [
            'wrong repository',
            repo,
            { full_name: 'Other/marketplace', default_branch: 'main' },
        ],
        [
            'moved ref',
            `${repo}/git/ref/tags/${originalAlpha1.tag}`,
            {
                ref: `refs/tags/${originalAlpha1.tag}`,
                object: { type: 'tag', sha: 'a'.repeat(40) },
            },
        ],
        [
            'rebuilt commit',
            `${repo}/git/tags/${originalAlpha1.tagObject}`,
            {
                sha: originalAlpha1.tagObject,
                tag: originalAlpha1.tag,
                object: { type: 'commit', sha: 'a'.repeat(40) },
            },
        ],
        [
            'replacement release',
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            { id: originalAlpha1.releaseId + 1, tag_name: originalAlpha1.tag },
        ],
        [
            'malformed release ID',
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            {
                id: String(originalAlpha1.releaseId),
                tag_name: originalAlpha1.tag,
            },
        ],
        [
            'wrong release tag',
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            { id: originalAlpha1.releaseId, tag_name: 'v1.0.0-alpha.2' },
        ],
        [
            'wrong package owner',
            pkg,
            {
                name: 'marketplace',
                package_type: 'container',
                repository: { full_name: 'Other/repo' },
            },
        ],
        [
            'extra image tag',
            versionsPath,
            [
                version(11, originalAlpha1.digest, [
                    originalAlpha1.tag,
                    'alpha',
                    'dev',
                ]),
            ],
        ],
        [
            'missing original version tag',
            versionsPath,
            [version(11, originalAlpha1.digest, ['alpha'])],
        ],
        [
            'replacement image',
            versionsPath,
            [
                version(11, `sha256:${'a'.repeat(64)}`, [
                    originalAlpha1.tag,
                    'alpha',
                ]),
            ],
        ],
        [
            'malformed version ID',
            versionsPath,
            [
                {
                    ...version(11, originalAlpha1.digest, [originalAlpha1.tag]),
                    id: '11',
                },
            ],
        ],
        [
            'ambiguous versions',
            versionsPath,
            [
                version(11, originalAlpha1.digest, [originalAlpha1.tag]),
                version(12, originalAlpha1.digest, [originalAlpha1.tag]),
            ],
        ],
        ['invalid page', versionsPath, {}],
        [
            'package authorization failure',
            versionsPath,
            new GitHubRequestError(403),
        ],
        ['package lookup failure', pkg, new GitHubRequestError(404)],
        [
            'release server failure',
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            new GitHubRequestError(500),
        ],
    ])('refuses every delete on %s', async (_name, path, value) => {
        const state = fixture()
        state.responses.set(path as string, value)
        await expect(
            resetOriginalAlpha1(state.request, context),
        ).rejects.toThrow()
        expect(state.calls.filter(([method]) => method === 'DELETE')).toEqual(
            [],
        )
    })

    test.each([
        'repository',
        'event',
        'ref',
        'workflowRef',
        'serverUrl',
        'apiUrl',
    ] as const)(
        'rejects untrusted context field %s before API calls',
        async (field) => {
            const state = fixture()
            await expect(
                resetOriginalAlpha1(state.request, {
                    ...context,
                    [field]: 'untrusted',
                }),
            ).rejects.toThrow('trusted workflow')
            expect(state.calls).toEqual([])
        },
    )

    test.each([true, false])(
        'retries safely after package removal, release missing=%s',
        async (releaseMissing) => {
            const state = fixture()
            state.responses.set(versionsPath, [
                version(12, `sha256:${'4'.repeat(64)}`, ['dev']),
            ])
            if (releaseMissing)
                state.responses.set(
                    `${repo}/releases/tags/${originalAlpha1.tag}`,
                    new GitHubRequestError(404),
                )
            expect(await resetOriginalAlpha1(state.request, context)).toEqual({
                packageDeleted: false,
                releaseDeleted: !releaseMissing,
            })
            expect(
                state.calls.filter(([method]) => method === 'DELETE'),
            ).toEqual(
                releaseMissing
                    ? []
                    : [
                          [
                              'DELETE',
                              `${repo}/releases/${originalAlpha1.releaseId}`,
                          ],
                      ],
            )
        },
    )

    test('validates subsequent pages before any deletion', async () => {
        const state = fixture()
        state.responses.set(
            versionsPath,
            Array.from({ length: 100 }, (_, index) =>
                version(index + 20, `sha256:${'4'.repeat(64)}`, ['dev']),
            ),
        )
        state.responses.set(
            `${pkg}/versions?state=active&per_page=100&page=2`,
            [version(11, originalAlpha1.digest, [originalAlpha1.tag, 'dev'])],
        )
        await expect(
            resetOriginalAlpha1(state.request, context),
        ).rejects.toThrow('original package version')
        expect(state.calls.filter(([method]) => method === 'DELETE')).toEqual(
            [],
        )
    })

    test('an unsuccessful package deletion stops release deletion', async () => {
        const state = fixture()
        const request: Alpha1Request = async (method, path) => {
            if (method === 'DELETE') {
                state.calls.push([method, path])
                throw new GitHubRequestError(403)
            }
            return state.request(method, path)
        }
        await expect(resetOriginalAlpha1(request, context)).rejects.toThrow(
            'HTTP 403',
        )
        expect(state.calls.filter(([method]) => method === 'DELETE')).toEqual([
            ['DELETE', `${pkg}/versions/11`],
        ])
    })

    test('an already absent release still permits only the original package deletion', async () => {
        const state = fixture()
        state.responses.set(
            `${repo}/releases/tags/${originalAlpha1.tag}`,
            new GitHubRequestError(404),
        )
        expect(await resetOriginalAlpha1(state.request, context)).toEqual({
            packageDeleted: true,
            releaseDeleted: false,
        })
        expect(state.calls.filter(([method]) => method === 'DELETE')).toEqual([
            ['DELETE', `${pkg}/versions/11`],
        ])
    })

    test('workflow has one trusted manual job and constrained publication permissions', async () => {
        const { YAML } = await import('bun')
        const workflow = record(
            YAML.parse(
                await Bun.file('.github/workflows/reset-alpha1.yml').text(),
            ),
        )
        const reset = record(record(workflow.jobs).reset)
        expect(Object.keys(record(workflow.on))).toEqual(['workflow_dispatch'])
        expect(workflow.permissions).toEqual({})
        expect(workflow.concurrency).toEqual({
            group: 'marketplace-release',
            'cancel-in-progress': false,
        })
        expect(reset.permissions).toEqual({
            contents: 'write',
            packages: 'write',
        })
        expect(reset.environment).toBe('container-publishing')
        expect(reset.if).toContain("github.ref == 'refs/heads/main'")
        expect(() => validateResetContext(context)).not.toThrow()
    })
})
