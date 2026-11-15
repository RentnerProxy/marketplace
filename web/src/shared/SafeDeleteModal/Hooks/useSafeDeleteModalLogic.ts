import type { SafeDeleteModalLogicReturn } from '../Types/types.ts'
import { useEffect } from 'react'
import type { UseSafeDeleteModalLogicProps } from '@/shared/SafeDeleteModal/Types/types.ts'
import useHasMounted from '@/shared/Hooks/useHasMounted.ts'

export default function useSafeDeleteModalLogic({
    isOpen,
}: UseSafeDeleteModalLogicProps): SafeDeleteModalLogicReturn {
    const mounted = useHasMounted()

    useEffect(() => {
        if (!isOpen) {
            return undefined
        }

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [isOpen])

    return {
        state: {
            shouldRender: isOpen && mounted,
        },
    }
}
