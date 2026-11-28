import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type {
    AppDetail,
    EditableStoreApp,
    StoreEntryEditor,
} from '@/features/AppStore/Types/app-store.types.ts'
import type { ProfileApp } from '@/features/Social/Types/social.types.ts'

type HandlerInput = { data?: { appId: string }; signal: AbortSignal }

const appId = 'rentner.weather-widget'
const detail: AppDetail = {
    appId,
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.2.0',
    publishedAt: '2026-10-02T00:00:00.000Z',
    description: null,
    logoSrc: null,
    screenshots: [],
    starCount: 3,
    isStarred: false,
    canEdit: false,
    publisher: null,
}
const editorEntry: StoreEntryEditor = {
    appId,
    name: 'Wetter',
    status: 'approved',
    isPublished: false,
    description: '',
    logoSrc: null,
    screenshots: [],
}
const editableApps: Array<EditableStoreApp> = [
    { appId, name: 'Wetter', status: 'published', logoSrc: null },
]
const publishedApps: Array<ProfileApp> = [
    {
        appId,
        name: 'Wetter',
        summary: 'Zeigt das Wetter.',
        license: 'MIT',
        version: '1.2.0',
        publishedAt: '2026-10-02T00:00:00.000Z',
        logoSrc: null,
        starCount: 3,
        isStarred: false,
    },
]

const getAppDetail = vi.fn(async (_input: HandlerInput) => detail)
const getStoreEntryEditor = vi.fn(async (_input: HandlerInput) => editorEntry)
const listEditableStoreApps = vi.fn(
    async (_input: HandlerInput) => editableApps,
)
const listPublishedApps = vi.fn(async (_input: HandlerInput) => publishedApps)

vi.mock('@/features/AppStore/middleware.ts', () => ({
    getAppDetailHandler: getAppDetail,
    getStoreEntryEditorHandler: getStoreEntryEditor,
    listEditableStoreAppsHandler: listEditableStoreApps,
    listPublishedAppsHandler: listPublishedApps,
}))

const {
    APP_STORE_QUERY_KEY,
    appDetailQueryOptions,
    editableStoreAppsQueryOptions,
    publishedAppsQueryOptions,
    storeEntryEditorQueryOptions,
} = await import('@/lib/AppStore/appStoreQueries.ts')

let client: QueryClient

function keyOf(options: { queryKey: ReadonlyArray<unknown> }): Array<unknown> {
    return [...options.queryKey]
}

beforeEach(() => {
    client = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    vi.clearAllMocks()
})

afterEach(() => {
    client.clear()
})

describe('app store query options', () => {
    it('keys public and editor queries per app below the app store key', () => {
        expect(keyOf(appDetailQueryOptions(appId))).toEqual([
            ...APP_STORE_QUERY_KEY,
            'detail',
            appId,
        ])
        expect(keyOf(storeEntryEditorQueryOptions(appId))).toEqual([
            ...APP_STORE_QUERY_KEY,
            'editor',
            appId,
        ])
        expect(keyOf(publishedAppsQueryOptions())).toEqual([
            ...APP_STORE_QUERY_KEY,
            'published',
        ])
        expect(keyOf(editableStoreAppsQueryOptions())).toEqual([
            ...APP_STORE_QUERY_KEY,
            'editable',
        ])
    })

    it('loads the public detail and the editor entry for the requested app', async () => {
        await expect(
            client.fetchQuery(appDetailQueryOptions(appId)),
        ).resolves.toBe(detail)
        await expect(
            client.fetchQuery(storeEntryEditorQueryOptions(appId)),
        ).resolves.toBe(editorEntry)

        for (const handler of [getAppDetail, getStoreEntryEditor]) {
            expect(handler).toHaveBeenCalledTimes(1)
            expect(handler.mock.calls[0]?.[0].data).toEqual({ appId })
            expect(handler.mock.calls[0]?.[0].signal).toBeInstanceOf(
                AbortSignal,
            )
        }
    })

    it('lists the published catalog and the own editable apps without input', async () => {
        await expect(
            client.fetchQuery(publishedAppsQueryOptions()),
        ).resolves.toBe(publishedApps)
        await expect(
            client.fetchQuery(editableStoreAppsQueryOptions()),
        ).resolves.toBe(editableApps)

        for (const handler of [listPublishedApps, listEditableStoreApps]) {
            expect(handler).toHaveBeenCalledTimes(1)
            expect(handler.mock.calls[0]?.[0].data).toBeUndefined()
            expect(handler.mock.calls[0]?.[0].signal).toBeInstanceOf(
                AbortSignal,
            )
        }
    })
})
