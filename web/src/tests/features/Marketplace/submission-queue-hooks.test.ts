import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import type {
    SubmissionMode,
    SubmissionRow,
} from '@/features/Marketplace/Types/components.types.ts'
import type { ActionMenuProps } from '@/shared/ActionMenu/Types/action-menu.types.ts'

type QueryOptions = {
    queryKey: ReadonlyArray<unknown>
    queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
    refetchInterval: number
}
type MutationOptions = {
    mutationFn: (variables: unknown) => Promise<unknown>
    onSuccess: (result: unknown, variables: unknown) => Promise<unknown>
    onError: (error: unknown) => Promise<unknown>
}

const queryCalls: Array<QueryOptions> = []
const pending: Array<Promise<unknown>> = []
const refetch = vi.fn(async () => {})
const invalidate = vi.fn(async (_filters: unknown) => {})
const toastSuccess = vi.fn()
const toastError = vi.fn()
let queryState: {
    data: unknown
    isPending: boolean
    isError: boolean
}
let mutationPending = false

const handlers = {
    getDeveloperSubmissionsHandler: vi.fn(async (_input: unknown) => ({})),
    getReviewSubmissionsHandler: vi.fn(async (_input: unknown) => ({})),
    getDeveloperSubmissionHandler: vi.fn(async (_input: unknown) => ({})),
    getReviewSubmissionHandler: vi.fn(async (_input: unknown) => ({})),
    reviewSubmissionHandler: vi.fn(async (_input: unknown) => ({})),
    revokeSubmissionHandler: vi.fn(async (_input: unknown) => ({})),
    withdrawSubmissionHandler: vi.fn(async (_input: unknown) => ({})),
}

vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: QueryOptions) => {
        queryCalls.push(options)
        return { ...queryState, refetch }
    },
    useQueryClient: () => ({ invalidateQueries: invalidate }),
    useMutation: (options: MutationOptions) => ({
        isPending: mutationPending,
        mutate(variables: unknown) {
            pending.push(
                options
                    .mutationFn(variables)
                    .then((result) => options.onSuccess(result, variables))
                    .catch((error: unknown) => options.onError(error)),
            )
        },
    }),
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { success: toastSuccess, error: toastError },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'en', t: (key: string) => key }),
}))
vi.mock('@/shared/ActionMenu/index.tsx', () => ({
    ActionMenu: ({ ariaLabel }: ActionMenuProps) =>
        createElement('menu', { 'aria-label': ariaLabel }),
}))
vi.mock('@/features/Marketplace/middleware.ts', () => handlers)

const { useSubmissionQueueLogic } =
    await import('@/features/Marketplace/Components/SubmissionQueue/Hooks/useSubmissionQueueLogic.tsx')
const { useSubmissionDetailsLogic } =
    await import('@/features/Marketplace/Components/SubmissionQueue/Hooks/useSubmissionDetailsLogic.ts')
const { ActionMenu } = await import('@/shared/ActionMenu/index.tsx')
const { default: SubmissionStatusBadge } =
    await import('@/features/Marketplace/Components/SubmissionQueue/Components/SubmissionStatusBadge.tsx')

const submissionId = '019f72d1-dc60-7040-bdac-9e201573f002'
const candidateId = 'a'.repeat(64)
const row = {
    id: submissionId,
    appId: 'rentner.weather-widget',
    version: '1.2.0',
    status: 'awaitingReview',
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
} as unknown as SubmissionRow

function detail(status: string, overrides: Record<string, unknown> = {}) {
    return {
        id: submissionId,
        revision: 3,
        status,
        validation: { candidate: { id: candidateId } },
        ...overrides,
    }
}

function lastQuery() {
    const query = queryCalls.at(-1)
    if (!query) throw new Error('Expected a query')
    return query
}

function submitEvent(intent: string | null) {
    const preventDefault = vi.fn()
    return {
        preventDefault,
        event: {
            preventDefault,
            nativeEvent: {
                submitter: intent
                    ? {
                          getAttribute: (name: string) =>
                              name === 'value' ? intent : null,
                      }
                    : null,
            },
        } as never,
    }
}

async function settle() {
    await Promise.all(pending.splice(0))
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    queryCalls.length = 0
    pending.length = 0
    mutationPending = false
    queryState = { data: undefined, isPending: false, isError: false }
})

function renderQueue(mode: SubmissionMode = 'developer', userId = 'dev-1') {
    return renderHook(() => useSubmissionQueueLogic({ mode, userId }))
}

function cell(
    logic: ReturnType<typeof useSubmissionQueueLogic>,
    index: number,
) {
    const render = logic.state.columns[index]?.cell as (context: {
        row: { original: SubmissionRow }
    }) => ReactElement<Record<string, unknown>>
    return render({ row: { original: row } })
}

function renderDetails(mode: SubmissionMode = 'review', userId = 'rev-1') {
    return renderHook(() =>
        useSubmissionDetailsLogic(mode, userId, submissionId),
    )
}

describe('submission queue logic', () => {
    it.each([
        ['developer', 'getDeveloperSubmissionsHandler'],
        ['review', 'getReviewSubmissionsHandler'],
    ] as const)(
        'polls the %s list page by page through its own handler',
        async (mode, handler) => {
            renderQueue(mode, 'user-1')
            const query = lastQuery()
            expect(query.queryKey).toEqual([
                'marketplace-submissions',
                'user-1',
                mode,
                'list',
                0,
            ])
            expect(query.refetchInterval).toBe(15_000)
            const signal = new AbortController().signal
            await query.queryFn({ signal })
            expect(handlers[handler]).toHaveBeenCalledWith({
                data: { page: 0 },
                signal,
            })
        },
    )

    it('renders app id, status badge, localized date and an actions menu per row', () => {
        const logic = renderQueue()
        expect(logic.state.columns.map((column) => column.header)).toEqual([
            'submissions.appId',
            'submissions.version',
            'common.status',
            'submissions.createdAt',
            'common.actions',
        ])
        expect(renderToStaticMarkup(cell(logic, 0))).toContain(
            '>rentner.weather-widget</span>',
        )
        const badge = cell(logic, 2)
        expect(badge.type).toBe(SubmissionStatusBadge)
        expect(badge.props.status).toBe('awaitingReview')
        const time = renderToStaticMarkup(cell(logic, 3))
        expect(time).toContain('dateTime="2026-01-01T12:00:00.000Z"')
        expect(time).toContain('2026')
        const menu = cell(logic, 4)
        expect(menu.type).toBe(ActionMenu)
        expect(menu.props.ariaLabel).toBe(
            'common.openActions (rentner.weather-widget 1.2.0)',
        )
    })

    it('opens the details of a row for the same queue only and closes them again', () => {
        queryState.data = { submissions: [row], hasMore: true }
        const menu = cell(renderQueue(), 4) as ReactElement<ActionMenuProps>
        const [details] = menu.props.items
        expect(details?.label).toBe('common.details')
        if (!details?.onSelect) throw new Error('Missing details action')
        details.onSelect()

        const opened = renderQueue()
        expect(opened.state.selectedSubmission).toBe(row)
        expect(opened.state.canGoNext).toBe(false)
        expect(renderQueue('developer', 'dev-2').state.selectedSubmission).toBe(
            null,
        )
        expect(renderQueue('review').state.selectedSubmission).toBe(null)

        renderQueue().handler.handleCloseDetails()
        expect(renderQueue().state.selectedSubmission).toBe(null)
    })

    it('moves between server pages only while more pages exist', () => {
        queryState.data = { submissions: [row], hasMore: true }
        let logic = renderQueue()
        expect(logic.state.submissions).toEqual([row])
        expect(logic.state.canGoBack).toBe(false)
        logic.handler.handlePreviousPage()
        expect(renderQueue().state.canGoBack).toBe(false)

        logic.handler.handleNextPage()
        logic = renderQueue()
        expect(lastQuery().queryKey.at(-1)).toBe(1)
        expect(logic.state.canGoBack).toBe(true)

        queryState.data = { submissions: [], hasMore: false }
        logic = renderQueue()
        expect(logic.state.canGoNext).toBe(false)
        logic.handler.handleNextPage()
        renderQueue()
        expect(lastQuery().queryKey.at(-1)).toBe(1)

        renderQueue().handler.handlePreviousPage()
        renderQueue()
        expect(lastQuery().queryKey.at(-1)).toBe(0)
    })

    it('reports a failed first load and retries it on request', () => {
        queryState = { data: undefined, isPending: false, isError: true }
        const failed = renderQueue()
        expect(failed.state.isError).toBe(true)
        expect(failed.state.submissions).toEqual([])
        failed.handler.handleRetry()
        expect(refetch).toHaveBeenCalledTimes(1)

        queryState = {
            data: { submissions: [row], hasMore: false },
            isPending: false,
            isError: true,
        }
        expect(renderQueue().state.isError).toBe(false)
    })
})

describe('submission details logic', () => {
    it.each([
        ['review', 'getReviewSubmissionHandler'],
        ['developer', 'getDeveloperSubmissionHandler'],
    ] as const)(
        'polls the %s detail through its own handler',
        async (mode, handler) => {
            renderDetails(mode, 'user-1')
            const query = lastQuery()
            expect(query.queryKey).toEqual([
                'marketplace-submissions',
                'user-1',
                mode,
                'detail',
                submissionId,
            ])
            expect(query.refetchInterval).toBe(15_000)
            const signal = new AbortController().signal
            await query.queryFn({ signal })
            expect(handlers[handler]).toHaveBeenCalledWith({
                data: { id: submissionId },
                signal,
            })
        },
    )

    it('derives the allowed actions from mode and status', () => {
        queryState.data = detail('awaitingReview')
        expect(renderDetails().state).toMatchObject({
            canReview: true,
            canRevoke: false,
            canWithdraw: false,
            language: 'en',
        })
        queryState.data = detail('awaitingReview', { validation: null })
        expect(renderDetails().state.canReview).toBe(false)
        for (const status of ['approved', 'publishing', 'published']) {
            queryState.data = detail(status)
            expect(renderDetails().state.canRevoke).toBe(true)
            expect(renderDetails('developer').state.canRevoke).toBe(false)
        }
        queryState.data = detail('validating')
        expect(renderDetails('developer').state.canWithdraw).toBe(true)
        queryState.data = detail('published')
        expect(renderDetails('developer').state.canWithdraw).toBe(false)
        queryState = {
            data: detail('approved'),
            isPending: false,
            isError: true,
        }
        expect(renderDetails().state).toMatchObject({
            detail: undefined,
            canRevoke: false,
            isError: true,
        })
    })

    it('approves the exact candidate with the entered reason and refreshes the queue', async () => {
        queryState.data = detail('awaitingReview')
        renderDetails().setter.setReason('Reviewed the exact commit')
        const { event, preventDefault } = submitEvent('approve')
        renderDetails().handler.handleSubmit(event)
        await settle()

        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(handlers.reviewSubmissionHandler).toHaveBeenCalledWith({
            data: {
                id: submissionId,
                revision: 3,
                reason: 'Reviewed the exact commit',
                candidateId,
                action: 'approve',
            },
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: ['marketplace-submissions', 'rev-1', 'review'],
        })
        expect(toastSuccess).toHaveBeenCalledWith(
            'submissions.feedback.approve',
            { title: 'submissions.title' },
        )
        expect(renderDetails().state.reason).toBe('')
    })

    it('rejects an empty reason locally and reloads the detail', async () => {
        queryState.data = detail('awaitingReview')
        renderDetails().handler.handleSubmit(submitEvent('reject').event)
        await settle()

        expect(handlers.reviewSubmissionHandler).not.toHaveBeenCalled()
        expect(toastError).toHaveBeenCalledWith(
            'submissions.feedback.invalidInput',
            { title: 'submissions.actionFailed' },
        )
        expect(refetch).toHaveBeenCalledTimes(1)
    })

    it('withdraws a developer submission and revokes an approved release', async () => {
        queryState.data = detail('approved')
        renderDetails('developer', 'dev-1').setter.setReason('Wrong build')
        renderDetails('developer', 'dev-1').handler.handleSubmit(
            submitEvent('withdraw').event,
        )
        await settle()
        expect(handlers.withdrawSubmissionHandler).toHaveBeenCalledWith({
            data: { id: submissionId, revision: 3, reason: 'Wrong build' },
        })
        expect(toastSuccess).toHaveBeenCalledWith(
            'submissions.feedback.withdraw',
            { title: 'submissions.title' },
        )

        resetHooks()
        renderDetails().setter.setReason('Ownership changed')
        renderDetails().handler.handleSubmit(submitEvent('revoke').event)
        await settle()
        expect(handlers.revokeSubmissionHandler).toHaveBeenCalledWith({
            data: {
                id: submissionId,
                revision: 3,
                reason: 'Ownership changed',
            },
        })
    })

    it('rejects an invalid stop request before calling the server', async () => {
        queryState.data = detail('approved')
        renderDetails().handler.handleSubmit(submitEvent('revoke').event)
        await settle()
        expect(handlers.revokeSubmissionHandler).not.toHaveBeenCalled()
        expect(toastError).toHaveBeenCalledWith(
            'submissions.feedback.invalidInput',
            { title: 'submissions.actionFailed' },
        )
    })

    it('shows a generic failure for unexpected server errors', async () => {
        queryState.data = detail('approved')
        handlers.revokeSubmissionHandler.mockRejectedValueOnce(
            new Error('socket hang up'),
        )
        renderDetails().setter.setReason('Ownership changed')
        renderDetails().handler.handleSubmit(submitEvent('revoke').event)
        await settle()
        expect(toastError).toHaveBeenCalledWith('submissions.feedback.error', {
            title: 'submissions.actionFailed',
        })
        expect(refetch).toHaveBeenCalledTimes(1)
    })

    it('ignores submissions that are not allowed, missing or already running', () => {
        queryState.data = detail('awaitingReview')
        renderDetails().setter.setReason('Reason')
        for (const intent of ['withdraw', 'revoke', null]) {
            renderDetails().handler.handleSubmit(submitEvent(intent).event)
        }
        mutationPending = true
        renderDetails().handler.handleSubmit(submitEvent('approve').event)
        mutationPending = false
        queryState.data = undefined
        const { event, preventDefault } = submitEvent('approve')
        renderDetails().handler.handleSubmit(event)

        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(pending).toHaveLength(0)
        for (const handler of Object.values(handlers)) {
            expect(handler).not.toHaveBeenCalled()
        }
    })
})
