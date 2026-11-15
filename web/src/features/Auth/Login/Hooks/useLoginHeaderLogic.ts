import type { LoginHeaderLogicReturn } from '../Types/login-logic.types.ts'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export default function useLoginHeaderLogic(): LoginHeaderLogicReturn {
    const { data: systemSettings } = useQuery(systemSettingsQueryOptions())
    const logoSrc =
        !systemSettings?.logoSrc || systemSettings.logoSrc === DEFAULT_IMAGE_SRC
            ? '/rentnerproxy-logo.png'
            : systemSettings.logoSrc

    return {
        state: {
            companyName:
                systemSettings?.companyName ?? PROJECT_CONFIG.defaultName,
            logoSrc,
            hasCustomLogo: Boolean(
                systemSettings?.logoSrc &&
                systemSettings.logoSrc !== DEFAULT_IMAGE_SRC,
            ),
        },
    }
}
