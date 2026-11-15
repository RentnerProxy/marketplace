import { useState } from 'react'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import type { FooterLogicReturn } from '../Types/footer-logic.types.ts'

export default function useFooterLogic(): FooterLogicReturn {
    const [currentYear] = useState(() => new Date().getFullYear())

    return {
        state: {
            appVersion: import.meta.env.VITE_APP_VERSION || 'Dev',
            companyName: PROJECT_CONFIG.defaultName,
            currentYear,
        },
    }
}
