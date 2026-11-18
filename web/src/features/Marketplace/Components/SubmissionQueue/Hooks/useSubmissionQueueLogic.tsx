import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TableColumn } from '@rentnerkev/table'
import { Eye } from 'lucide-react'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { authenticatedTableActionColumn } from '@/lib/Table/authenticatedTableStyles.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import {
    getDeveloperSubmissionsHandler,
    getReviewSubmissionsHandler,
} from '../../../middleware.ts'
import type {
    SubmissionQueueProps,
    SubmissionRow,
} from '../../../Types/components.types.ts'
import SubmissionStatusBadge from '../Components/SubmissionStatusBadge.tsx'

const emptySubmissions: SubmissionRow[] = []

export function useSubmissionQueueLogic({
    mode,
    userId,
}: SubmissionQueueProps) {
    const { language, t } = useTranslationStore()
    const appIdLabel = t('submissions.appId')
    const versionLabel = t('submissions.version')
    const statusLabel = t('common.status')
    const createdAtLabel = t('submissions.createdAt')
    const actionsLabel = t('common.actions')
    const [page, setPage] = useState(0)
    const [selection, setSelection] = useState<
        (SubmissionQueueProps & { submission: SubmissionRow }) | null
    >(null)
    const selectedSubmission =
        selection?.mode === mode && selection.userId === userId
            ? selection.submission
            : null

    const list = useQuery({
        queryKey: ['marketplace-submissions', userId, mode, 'list', page],
        queryFn: ({ signal }) =>
            (mode === 'review'
                ? getReviewSubmissionsHandler
                : getDeveloperSubmissionsHandler)({
                data: { page },
                signal,
            }),
        refetchInterval: CANDIDATE_PIPELINE.pollMs,
    })

    const columns = useMemo<TableColumn<SubmissionRow>[]>(() => {
        const dateFormatter = new Intl.DateTimeFormat(language, {
            dateStyle: 'medium',
            timeStyle: 'short',
        })
        return [
            {
                accessorKey: 'appId',
                header: appIdLabel,
                size: 280,
                minSize: 225,
                cell: ({ row }) => (
                    <span className="wrap-anywhere font-medium text-white">
                        {row.original.appId}
                    </span>
                ),
            },
            {
                accessorKey: 'version',
                header: versionLabel,
                size: 130,
                minSize: 110,
            },
            {
                accessorKey: 'status',
                header: statusLabel,
                size: 150,
                minSize: 130,
                cell: ({ row }) => (
                    <SubmissionStatusBadge status={row.original.status} />
                ),
            },
            {
                accessorKey: 'createdAt',
                header: createdAtLabel,
                size: 175,
                minSize: 155,
                cell: ({ row }) => {
                    const date = new Date(row.original.createdAt)
                    return (
                        <time dateTime={date.toISOString()}>
                            {dateFormatter.format(date)}
                        </time>
                    )
                },
            },
            {
                ...authenticatedTableActionColumn,
                header: actionsLabel,
                cell: ({ row }) => (
                    <ActionMenu
                        ariaLabel={`${t('common.openActions')} (${row.original.appId} ${row.original.version})`}
                        items={[
                            {
                                id: 'details',
                                label: t('common.details'),
                                onSelect: () =>
                                    setSelection({
                                        mode,
                                        userId,
                                        submission: row.original,
                                    }),
                                icon: <Eye className="size-4" />,
                            },
                        ]}
                    />
                ),
            },
        ]
    }, [
        actionsLabel,
        appIdLabel,
        createdAtLabel,
        language,
        mode,
        statusLabel,
        t,
        userId,
        versionLabel,
    ])

    const canGoBack = !selectedSubmission && page > 0
    const canGoNext =
        !selectedSubmission && list.data?.hasMore === true && page < 1000

    function handlePreviousPage() {
        if (canGoBack) setPage(page - 1)
    }

    function handleNextPage() {
        if (canGoNext) setPage(page + 1)
    }

    function handleCloseDetails() {
        setSelection(null)
    }

    function handleRetry() {
        void list.refetch()
    }

    return {
        state: {
            columns,
            submissions: list.data?.submissions ?? emptySubmissions,
            isPending: list.isPending,
            isError: list.isError && !list.data,
            selectedSubmission,
            canGoBack,
            canGoNext,
        },
        handler: {
            handlePreviousPage,
            handleNextPage,
            handleCloseDetails,
            handleRetry,
        },
    }
}
