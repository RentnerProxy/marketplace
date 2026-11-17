import type { TableMessages } from '@rentnerkev/table/types'
import type useTranslationStore from '@/language/useTranslationStore.ts'

export function getMarketplaceTableMessages(
    t: ReturnType<typeof useTranslationStore>['t'],
    itemLabel: string,
): Partial<TableMessages> {
    return {
        all: t('common.all'),
        anyDate: t('shared.table.dateRangePlaceholder'),
        filters: t('shared.table.columnFilters'),
        filterColumn: (column) =>
            t('shared.table.filterColumnPlaceholder', { column }),
        rowsPerPage: t('shared.table.rowsPerPage'),
        firstPage: t('shared.table.firstPage'),
        previousPage: t('shared.table.previousPage'),
        nextPage: t('shared.table.nextPage'),
        lastPage: t('shared.table.lastPage'),
        pageInfo: (currentPage, totalPages) =>
            t('shared.table.pageInfo', {
                currentPage,
                totalPages: totalPages ?? currentPage,
            }),
        rowRange: (firstRowNumber, lastRowNumber, total) =>
            t('shared.table.rowRange', {
                firstRowNumber,
                lastRowNumber,
                filteredRowsCount: total ?? lastRowNumber,
                itemLabel,
            }),
    }
}
