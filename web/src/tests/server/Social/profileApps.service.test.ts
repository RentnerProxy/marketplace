import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createQueuedDatabase } from './social-db.test.helpers.ts'

const database = createQueuedDatabase()
vi.mock('@/db', () => ({ db: database.db }))

const { getProfileAppsService } =
    await import('@/server/Social/profileApps.service.ts')

const ownerId = '019f72d1-dc60-7040-bdac-9e201573f002'
const viewerId = '019f72d1-dc60-7040-bdac-9e201573f001'

function submissionRow(
    appId: string,
    name: string,
    createdAt: string,
    publishedAt: string | null,
) {
    return {
        appId,
        version: '1.2.0',
        request: {
            display: { name, summary: `${name} summary`, license: 'MIT' },
        },
        publication: publishedAt ? { publishedAt } : null,
        createdAt: new Date(createdAt),
        logoFileId:
            appId === 'rentner.alpha'
                ? '019f72d1-dc60-7040-bdac-9e201573f0aa'
                : null,
    }
}

beforeEach(() => {
    database.reset()
})

describe('profile apps', () => {
    it('returns null for unknown or hidden accounts', async () => {
        database.queue([])
        await expect(
            getProfileAppsService({ username: 'ghost' }, null),
        ).resolves.toBeNull()
    })

    it('lists the latest published versions newest first with stars', async () => {
        database.queue(
            [{ id: ownerId }],
            [
                submissionRow(
                    'rentner.alpha',
                    'Alpha',
                    '2026-10-01T00:00:00.000Z',
                    '2026-10-02T00:00:00.000Z',
                ),
                submissionRow(
                    'rentner.beta',
                    'Beta',
                    '2026-11-01T00:00:00.000Z',
                    null,
                ),
            ],
            [{ appId: 'rentner.alpha', value: 5 }],
            [{ appId: 'rentner.beta' }],
        )

        await expect(
            getProfileAppsService({ username: 'kevin' }, viewerId),
        ).resolves.toEqual([
            {
                appId: 'rentner.beta',
                name: 'Beta',
                summary: 'Beta summary',
                license: 'MIT',
                version: '1.2.0',
                publishedAt: '2026-11-01T00:00:00.000Z',
                logoSrc: null,
                starCount: 0,
                isStarred: true,
            },
            {
                appId: 'rentner.alpha',
                name: 'Alpha',
                summary: 'Alpha summary',
                license: 'MIT',
                version: '1.2.0',
                publishedAt: '2026-10-02T00:00:00.000Z',
                logoSrc:
                    '/images/apps/rentner.alpha/019f72d1-dc60-7040-bdac-9e201573f0aa.webp',
                starCount: 5,
                isStarred: false,
            },
        ])
        expect(database.methods()).toContain('selectDistinctOn')
    })

    it('returns an empty list without published apps', async () => {
        database.queue([{ id: ownerId }], [])
        await expect(
            getProfileAppsService({ username: 'kevin' }, null),
        ).resolves.toEqual([])
    })
})
