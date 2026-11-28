import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { Search, Star } from 'lucide-react'
import {
    APP_CATALOG_CONFIG,
    APP_CATALOG_SORTS,
} from '@/config/app-catalog.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { AppCatalogToolbarProps } from '../Types/app-catalog.types.ts'

export default function AppCatalogToolbar({
    state,
    handler,
}: AppCatalogToolbarProps) {
    const { t } = useTranslationStore()

    return (
        <div className="comic-panel flex flex-col gap-3 bg-surface-dark p-4 text-foreground sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
                <TextInput
                    value={state.query}
                    onValueChange={handler.handleQueryChange}
                    placeholder={t('catalog.searchPlaceholder')}
                    aria-label={t('catalog.searchPlaceholder')}
                    icon={<Search className="h-4 w-4" />}
                    maxLength={APP_CATALOG_CONFIG.searchMaxLength}
                />
            </div>
            <div className="sm:w-56">
                <CustomSelect
                    label={t('catalog.sortLabel')}
                    value={state.sort}
                    onValueChange={handler.handleSortChange}
                    options={APP_CATALOG_SORTS.map((sort) => ({
                        value: sort,
                        label: t(`catalog.sort.${sort}`),
                    }))}
                />
            </div>
            {state.isSignedIn && (
                <button
                    type="button"
                    aria-pressed={state.starredOnly}
                    onClick={handler.handleToggleStarredOnly}
                    className={`comic-btn comic-btn-sm h-11 ${state.starredOnly ? '' : 'comic-btn-white'}`}
                >
                    <Star
                        aria-hidden="true"
                        className={`h-4 w-4 ${state.starredOnly ? 'fill-current' : ''}`}
                    />
                    {t('catalog.starredOnly')}
                </button>
            )}
        </div>
    )
}
