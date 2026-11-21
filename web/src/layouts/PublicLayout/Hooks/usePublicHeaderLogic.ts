import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'
import type { PublicHeaderLogicReturn } from '../Types/public-header-logic.types.ts'

export default function usePublicHeaderLogic(): PublicHeaderLogicReturn {
    const [isScrolled, setIsScrolled] = useState(false)
    const settings = useQuery(systemSettingsQueryOptions())

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        function updateScrollState() {
            setIsScrolled(window.scrollY > 24)
        }

        updateScrollState()
        window.addEventListener('scroll', updateScrollState, { passive: true })
        return () => window.removeEventListener('scroll', updateScrollState)
    }, [])

    return {
        state: {
            isScrolled,
            isPublicRegistrationEnabled:
                settings.data?.isPublicRegistrationEnabled === true,
        },
    }
}
