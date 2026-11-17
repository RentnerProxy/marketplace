import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/Date/date.ts'

export default function useBackupCountdown(nextBackupAt: string | null) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!nextBackupAt) return undefined
        const interval = window.setInterval(() => setNow(Date.now()), 1_000)

        return () => window.clearInterval(interval)
    }, [nextBackupAt])

    return nextBackupAt
        ? formatCountdown(Math.max(0, new Date(nextBackupAt).getTime() - now))
        : null
}
