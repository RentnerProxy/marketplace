import { DataTable, type DataTableProps } from '@rentnerkev/table'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { authenticatedTableLayout } from '@/lib/Table/authenticatedTableStyles.ts'
import { getMarketplaceTableLocale } from '@/lib/Table/tableMessages.ts'
import { SubmissionDetails } from './Components/SubmissionDetails.tsx'
import { useSubmissionQueueLogic } from './Hooks/useSubmissionQueueLogic.tsx'
import type {
    SubmissionQueueProps,
    SubmissionRow,
} from '../../Types/components.types.ts'

const tableOptions: DataTableProps<SubmissionRow>['tableOptions'] = {
    enableSorting: false,
}

export function SubmissionQueue(props: SubmissionQueueProps) {
    const { language, t } = useTranslationStore()
    const { state, handler } = useSubmissionQueueLogic(props)

    return (
        <section className="min-w-0 space-y-3">
            <DataTable
                {...authenticatedTableLayout}
                locale={getMarketplaceTableLocale(
                    language,
                    t,
                    t('submissions.queue'),
                )}
                title={t('submissions.queue')}
                showRowCount={false}
                data={state.submissions}
                columns={state.columns}
                getRowId={(submission) => submission.id}
                tableOptions={tableOptions}
                pagination={false}
                searchable={false}
                columnFilters={false}
                columnVisibility={false}
                isLoading={state.isPending}
                error={state.isError && t('submissions.loadError')}
                onRetry={handler.handleRetry}
                loadingState={t('submissions.loading')}
                emptyState={t('submissions.empty')}
            />
            <div className="flex justify-end gap-3 text-sm">
                <button
                    type="button"
                    className="marketplace-table-control cursor-pointer disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={!state.canGoBack}
                    onClick={handler.handlePreviousPage}
                >
                    {t('submissions.previous')}
                </button>
                <button
                    type="button"
                    className="marketplace-table-control cursor-pointer disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={!state.canGoNext}
                    onClick={handler.handleNextPage}
                >
                    {t('submissions.next')}
                </button>
            </div>
            {state.selectedSubmission && (
                <SubmissionDetails
                    {...props}
                    key={state.selectedSubmission.id}
                    submission={state.selectedSubmission}
                    onClose={handler.handleCloseDetails}
                />
            )}
        </section>
    )
}
