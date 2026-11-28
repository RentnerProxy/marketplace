import type { AuthenticatedPageHeaderLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import { useRouterState } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ACCOUNT_PAGE_ITEMS, NAVBAR_ITEMS } from '@/config/navbar.config.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

type NavigationLabelKey = AuthenticatedNavItem['labelKey']

function findNavigationItem(
    items: Array<AuthenticatedNavItem>,
    pathname: string,
    groupKey: NavigationLabelKey | null = null,
): { item: AuthenticatedNavItem; groupKey: NavigationLabelKey | null } | null {
    for (const item of items) {
        if (item.to === pathname) {
            return { item, groupKey }
        }

        if (item.children) {
            const match = findNavigationItem(
                item.children,
                pathname,
                groupKey ?? item.labelKey,
            )
            if (match) return match
        }
    }

    return null
}

export default function useAuthenticatedPageHeaderLogic(): AuthenticatedPageHeaderLogicReturn {
    const { t } = useTranslationStore()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const match = findNavigationItem(
        [...NAVBAR_ITEMS, ...ACCOUNT_PAGE_ITEMS],
        pathname,
    )

    return {
        state: {
            groupKey: match?.groupKey ?? null,
            eyebrow: match?.groupKey ? t(match.groupKey) : null,
            title: t(match?.item.title ?? 'layout.topbar.defaultTitle'),
            description: t(
                match?.item.description ?? 'layout.topbar.defaultDescription',
            ),
        },
    }
}
