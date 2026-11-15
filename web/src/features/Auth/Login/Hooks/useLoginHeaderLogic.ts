import type { LoginHeaderLogicReturn } from '../Types/login-logic.types.ts'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export default function useLoginHeaderLogic(): LoginHeaderLogicReturn {
    const { data: systemSettings } = useQuery(systemSettingsQueryOptions())
    const configuredLogo = systemSettings?.logoSrc
    const hasCustomLogo = Boolean(
        configuredLogo &&
        configuredLogo !== DEFAULT_IMAGE_SRC &&
        configuredLogo !== '/rentnerproxy-logo.png',
    )

    return {
        state: {
            companyName:
                systemSettings?.companyName?.trim() ||
                PROJECT_CONFIG.defaultName,
            logoSrc:
                hasCustomLogo && configuredLogo
                    ? configuredLogo
                    : '/rentnerproxy-logo.png',
            hasCustomLogo,
        },
    }
}
