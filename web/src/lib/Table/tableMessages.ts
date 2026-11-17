import type {
    TableDateRangeOptions,
    TableLocaleOption,
    TableMessages,
} from '@rentnerkev/table/types'
import {
    CALENDAR_LOCALES,
    TABLE_LOCALES,
} from '@/config/language-library.config.ts'
import type useTranslationStore from '@/language/useTranslationStore.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'

export function getMarketplaceTableLocale(
    language: AppLanguage,
    t: ReturnType<typeof useTranslationStore>['t'],
    itemLabel: string,
    overrides?: Partial<TableMessages>,
): TableLocaleOption {
    const messages: Partial<TableMessages> = {
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
        ...overrides,
    }
    return { code: TABLE_LOCALES[language], messages }
}

export function getMarketplaceTableDateRangeOptions(
    language: AppLanguage,
): TableDateRangeOptions {
    return {
        locale: CALENDAR_LOCALES[language],
        weekStartsOn: 1,
        showHolidays: true,
        fastEdit: true,
        backdrop: true,
    }
}
