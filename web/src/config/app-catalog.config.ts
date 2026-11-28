/** Client-side catalog controls; the server returns up to APP_STORE_CONFIG.catalogLimit apps. */
export const APP_CATALOG_SORTS = ['newest', 'stars', 'name'] as const

export const APP_CATALOG_CONFIG = {
    defaultSort: 'newest',
    searchMaxLength: 80,
} as const
