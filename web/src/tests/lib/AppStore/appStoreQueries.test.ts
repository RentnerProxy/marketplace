import { describe, expect, it, vi } from 'bun:test'

const handlers = {
    detail: vi.fn(async (_input: unknown) => null),
    published: vi.fn(async (_input: unknown) => []),
    editor: vi.fn(async (_input: unknown) => null),
    editable: vi.fn(async (_input: unknown) => []),
}

vi.mock('@tanstack/react-query', () => ({
    queryOptions: (options: unknown) => options,
}))
vi.mock('@/features/AppStore/middleware.ts', () => ({
    getAppDetailHandler: handlers.detail,
    listPublishedAppsHandler: handlers.published,
    getStoreEntryEditorHandler: handlers.editor,
    listEditableStoreAppsHandler: handlers.editable,
}))

const queries = await import('@/lib/AppStore/appStoreQueries.ts')

type QueryOptions = {
    queryKey: ReadonlyArray<string>
    queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
}

function asOptions(options: unknown) {
    return options as QueryOptions
}

describe('app store queries', () => {
    const signal = new AbortController().signal

    it('keys every store query below the shared app store key', async () => {
        const detail = asOptions(queries.appDetailQueryOptions('rentner.app'))
        expect(detail.queryKey).toEqual(['app-store', 'detail', 'rentner.app'])
        await detail.queryFn({ signal })
        expect(handlers.detail).toHaveBeenCalledWith({
            data: { appId: 'rentner.app' },
            signal,
        })

        const published = asOptions(queries.publishedAppsQueryOptions())
        expect(published.queryKey).toEqual(['app-store', 'published'])
        await published.queryFn({ signal })
        expect(handlers.published).toHaveBeenCalledWith({ signal })

        const editor = asOptions(
            queries.storeEntryEditorQueryOptions('rentner.app'),
        )
        expect(editor.queryKey).toEqual(['app-store', 'editor', 'rentner.app'])
        await editor.queryFn({ signal })
        expect(handlers.editor).toHaveBeenCalledWith({
            data: { appId: 'rentner.app' },
            signal,
        })

        const editable = asOptions(queries.editableStoreAppsQueryOptions())
        expect(editable.queryKey).toEqual(['app-store', 'editable'])
        await editable.queryFn({ signal })
        expect(handlers.editable).toHaveBeenCalledWith({ signal })
        expect(queries.APP_STORE_QUERY_KEY).toEqual(['app-store'])
    })
})
