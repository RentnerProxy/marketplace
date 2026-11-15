import { useEffect, useMemo, useState } from 'react'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { getRouteErrorDetails } from '@/lib/Errors/routeErrorDetails.ts'
import type {
    RouteErrorLogicReturn,
    UseRouteErrorLogicProps,
} from '@/shared/RouteErrorComponent/Types/routeError.types.ts'

function handleReload() {
    window.location.reload()
}

export default function useRouteErrorLogic({
    error,
    info,
}: UseRouteErrorLogicProps): RouteErrorLogicReturn {
    const [copied, setCopied] = useState(false)
    const [isTechnicalDetailsOpen, setIsTechnicalDetailsOpen] = useState(false)
    const details = useMemo(
        () => getRouteErrorDetails(error, info?.componentStack),
        [error, info?.componentStack],
    )

    useEffect(() => {
        toastAppError(
            import.meta.env.DEV
                ? error
                : new AppError('Die Anfrage konnte nicht verarbeitet werden.'),
        )
    }, [error])

    async function handleCopyTechnicalDetails() {
        try {
            await navigator.clipboard.writeText(details.technicalDetails)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopied(false)
        }
    }

    return {
        state: {
            copied,
            details,
            isTechnicalDetailsOpen,
        },
        handler: {
            handleCopyTechnicalDetails,
            handleReload,
        },
        setter: {
            setIsTechnicalDetailsOpen,
        },
    }
}
