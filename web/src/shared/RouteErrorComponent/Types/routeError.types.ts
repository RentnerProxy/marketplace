import type { ErrorComponentProps } from '@tanstack/react-router'

import type { RouteErrorDetails } from '@/lib/Errors/Types/route-error.types.ts'

export type UseRouteErrorLogicProps = ErrorComponentProps

export type RouteErrorLogicReturn = {
    state: {
        copied: boolean
        details: RouteErrorDetails
        isTechnicalDetailsOpen: boolean
    }
    handler: {
        handleCopyTechnicalDetails: () => Promise<void>
        handleReload: () => void
    }
    setter: {
        setIsTechnicalDetailsOpen: (value: boolean) => void
    }
}
