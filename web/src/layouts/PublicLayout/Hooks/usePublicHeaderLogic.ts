import { useEffect, useState } from 'react'
import type { PublicHeaderLogicReturn } from '../Types/public-header-logic.types.ts'

export default function usePublicHeaderLogic(): PublicHeaderLogicReturn {
    const [isScrolled, setIsScrolled] = useState(false)

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        function updateScrollState() {
            setIsScrolled(window.scrollY > 24)
        }

        updateScrollState()
        window.addEventListener('scroll', updateScrollState, { passive: true })
        return () => window.removeEventListener('scroll', updateScrollState)
    }, [])

    return { state: { isScrolled } }
}
